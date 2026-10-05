#!/usr/bin/env python3
"""Drive out/web in headless Chrome and check what actually happens.

Two stages share one Chrome profile directory:
  stage 1  pick the ROM -> extract in-browser -> play tests/play-newgame.txt
           with synthetic key events -> read game state and canvas pixels back
  stage 2  fresh page load in the same profile -> the save must still be there

Chrome is started muted and the page is loaded without ?audio=1, so no audio
device is ever opened.
"""
import argparse
import json
import os
import pathlib
import shutil
import socket
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'out'
RESULT = OUT / 'browsercheck' / 'result.json'

CHROME_FLAGS = [
    '--headless=new',
    '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-swiftshader',   # WebGL without a real GPU
    '--window-size=900,760',
]


def wait_for_server(port, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/index.html', timeout=1).read(1)
            return
        except Exception:
            time.sleep(0.2)
    sys.exit('local server did not come up')


def kill_stale_chrome(profile):
    """Any Chrome still holding this profile will swallow the next launch's URL
    and answer with its own restored tab.  Make sure none is left."""
    out = subprocess.run(['ps', '-eo', 'pid,args'], capture_output=True, text=True).stdout
    killed = 0
    for line in out.splitlines():
        if str(profile) in line and 'ps -eo' not in line:
            try:
                os.kill(int(line.split(None, 1)[0]), signal.SIGKILL)
                killed += 1
            except (ValueError, ProcessLookupError, PermissionError):
                pass
    if killed:
        print(f'killed {killed} stale chrome process(es)')
        time.sleep(1)


def run_stage(chrome, profile, port, stage, timeout, keep_result):
    if RESULT.exists():
        RESULT.unlink()
    for old in (OUT / 'browsercheck').glob('*.png'):
        if not keep_result:
            old.unlink()
    kill_stale_chrome(profile)
    url = f'http://127.0.0.1:{port}/browsercheck.html?stage={stage}'
    print(f'--- stage {stage}: {url}', flush=True)
    proc = subprocess.Popen([chrome, *CHROME_FLAGS, f'--user-data-dir={profile}', url],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            if RESULT.exists():
                time.sleep(0.4)      # let the write settle
                got = json.loads(RESULT.read_text())
                if str(got.get('stage')) != str(stage):
                    sys.exit(f'stage {stage}: got a report for stage {got.get("stage")} '
                             '- a stale browser tab answered instead')
                return got
            if proc.poll() is not None:
                break
            time.sleep(0.5)
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    sys.exit(f'stage {stage}: no result after {timeout}s (chrome exit={proc.poll()})')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=0, help='0 picks a free port')
    ap.add_argument('--timeout', type=int, default=900)
    ap.add_argument('--keep-profile', action='store_true',
                    help='reuse the Chrome profile, so the asset cache is warm')
    args = ap.parse_args()

    if not args.port:
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            args.port = s.getsockname()[1]

    chrome = shutil.which('google-chrome') or shutil.which('chromium')
    if not chrome:
        sys.exit('no chrome/chromium on PATH')
    if not (OUT / 'web' / 'zelda3.wasm').exists():
        sys.exit('out/web/zelda3.wasm missing - run build-browser.py and stage-web.py')

    profile = OUT / 'chrome-profile'
    kill_stale_chrome(profile)
    if not args.keep_profile and profile.exists():
        shutil.rmtree(profile)
    profile.mkdir(parents=True, exist_ok=True)
    (OUT / 'browsercheck').mkdir(parents=True, exist_ok=True)

    server = subprocess.Popen([sys.executable, str(ROOT / 'scripts' / 'serve.py'),
                               '--port', str(args.port)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for_server(args.port)
        r1 = run_stage(chrome, profile, args.port, 1, args.timeout, keep_result=False)
        shutil.copy2(RESULT, OUT / 'browsercheck' / 'result-stage1.json')
        r2 = run_stage(chrome, profile, args.port, 2, 300, keep_result=True)
        shutil.copy2(RESULT, OUT / 'browsercheck' / 'result-stage2.json')
    finally:
        server.send_signal(signal.SIGTERM)
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()

    problems = list(r1.get('failures', [])) + list(r2.get('failures', []))
    end, boot = r1.get('saveFileAtEnd'), r2.get('saveFileAtBoot')
    if not end or not boot:
        problems.append('no /saves/sram.dat on one side of the reload')
    elif end != boot:
        problems.append(f'save file changed across reload: {end} != {boot}')
    if r2.get('assetsFromCache') is not True:
        problems.append('stage 2 re-extracted the assets instead of using the cache')

    summary = {
        'rom': r1.get('rom'),
        'assetsBytes': r1.get('assetsBytes'),
        'extractedInBrowser': r1.get('assetsFromCache') is False,
        'playWallClockSeconds': r1.get('wallClockSeconds'),
        'framesPlayed': (r1.get('steps') or [{}])[-1].get('frame'),
        'assetsSha1': r1.get('assetsSha1'),
        'saveFileAtEndOfPlay': r1.get('saveFileAtEnd'),
        'saveFileAfterReload': r2.get('saveFileAtBoot'),
        'saveSurvivedReload': r2.get('saveFileFoundAtBoot') and r2.get('slot1UsedAtBoot'),
        'problems': problems,
    }
    (OUT / 'browsercheck' / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    if problems:
        print('\nFAILED')
        return 1
    print('\nOK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
