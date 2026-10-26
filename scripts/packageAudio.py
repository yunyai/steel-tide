"""Curate recorded audio derivatives. Requires ffmpeg and the licensed source packs.
Run: python3 scripts/packageAudio.py --helton DIR --kenney DIR --sonniss DIR
Sources are never shipped; public/audio/manifest.json records provenance and edits.
"""
import argparse
import binascii
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
for family in ['helton', 'kenney', 'sonniss']:
    parser.add_argument('--' + family, type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'public/audio'
manifest = json.loads((out / 'manifest.json').read_text())
entries = []


def clip(name, family, source, author, start, duration, *, rate=1, lowpass=None, highpass=None, loop=0, sequence=None, reverse=False, target=-21):
    base = getattr(args, family)
    src = base / source
    if not src.exists():
        src = base / Path(source).name
    if not src.exists():
        raise FileNotFoundError(src)
    extension = '.wav' if loop else '.m4a'
    dest = out / (name + extension)
    filters = [f'atrim=start={start}:duration={duration}', 'asetpts=PTS-STARTPTS', 'aformat=sample_rates=44100:channel_layouts=mono']
    if rate != 1:
        filters += [f'asetrate={44100 * rate}', 'aresample=44100']
    if lowpass:
        filters += [f'lowpass=f={lowpass}']
    if highpass:
        filters += [f'highpass=f={highpass}']
    if reverse:
        filters += ['areverse']
    graph = '[0:a]' + ','.join(filters) + '[base];'
    length = duration / rate
    if sequence:
        # Pitch and sequence a recorded confirmation; no waveform synthesis.
        count = len(sequence)
        graph += '[base]asplit=' + str(count) + ''.join(f'[s{i}]' for i in range(count)) + ';'
        for i, (semitones, delay) in enumerate(sequence):
            pitch = 2 ** (semitones / 12)
            graph += f'[s{i}]asetrate={44100 * pitch},aresample=44100,adelay={round(delay * 1000)}:all=1[n{i}];'
        graph += ''.join(f'[n{i}]' for i in range(count)) + f'amix=inputs={count}:normalize=0[mix];'
        length = max(delay + length / (2 ** (semi / 12)) for semi, delay in sequence)
    elif loop:
        # Rotate the recording, then crossfade its end into the omitted head.
        graph += f'[base]asplit=2[a][b];[a]atrim=start={loop},asetpts=PTS-STARTPTS[tail];[b]atrim=end={loop},asetpts=PTS-STARTPTS[head];[tail][head]acrossfade=d={loop}:c1=tri:c2=tri[mix];'
        length -= loop
    else:
        graph += '[base]anull[mix];'
    finish = [f'loudnorm=I={target}:TP=-3:LRA=7']
    if not loop:
        finish += ['afade=t=in:st=0:d=0.003', f'afade=t=out:st={max(0, length - .06)}:d=0.06']
    graph += '[mix]' + ','.join(finish) + '[done]'
    codec = ['-ar', '32000', '-c:a', 'pcm_s16le'] if loop else ['-ar', '44100', '-c:a', 'aac', '-b:a', '96k']
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-filter_complex', graph, '-map', '[done]', '-vn', '-ac', '1', *codec, str(dest)], check=True)
    source_info = {
        'helton': ('https://heltonyan.itch.io/retroanimesfx', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
        'kenney': ('https://kenney.nl/assets/sci-fi-sounds', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'),
        'sonniss': ('https://sonniss.com/gameaudiogdc/', 'Sonniss #GameAudioGDC Bundle License v2.0 (27 August 2026)', 'https://sonniss.com/gdc-bundle-license/'),
    }[family]
    entry = dict(file=dest.name, sourceFile=source, author=author, source=source_info[0], license=source_info[1], licenseUrl=source_info[2], sourceSha256=hashlib.sha256(src.read_bytes()).hexdigest(), modifications=f'{start:g}–{start + duration:g} s excerpt; rate {rate:g}; mono; normalized to {target} LUFS / -3 dBTP; ' + ('32 kHz PCM16, circular crossfade ' + str(loop) + ' s' if loop else '44.1 kHz AAC 96 kbit/s, 3 ms attack / 60 ms tail fades'))
    if lowpass:
        entry['modifications'] += f'; {lowpass} Hz low-pass'
    if highpass:
        entry['modifications'] += f'; {highpass} Hz high-pass'
    if sequence:
        entry['modifications'] += '; recorded-note sequence ' + json.dumps(sequence)
    if reverse:
        entry['modifications'] += '; reversed'
    if family == 'sonniss':
        entry['archive'] = 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip'
    entry['sourceCrc32'] = f'{binascii.crc32(src.read_bytes()):08x}'
    entries.append(entry)
    print(dest.name, dest.stat().st_size, flush=True)


S = 'sonniss'
H = 'helton'
K = 'kenney'
ca = 'Coll Anderson'
eir = 'Eiravaein Works'
beep = 'SoundMorph - Users of Tommorow/confirm_beepy_02.wav'
ton = 'Eiravaein Works - Start Select/StartSelect,UI,set3,pure,warm,simple,quick,tonal,deaction.wav'
click = 'Eiravaein Works - Start Select/StartSelect,UI,set34,mechanical,subtle,percussive,thick,bright,holdrelease.wav'
plate = 'Coll Anderson - Metal Plate/EFX SD Metal plate bang 01 B.M.wav'
m4 = 'Coll Anderson - Guns/EFX EXT M4 Shots 02 B.wav'
mortar = 'Coll Anderson - Guns/EFX EXT Mortar Explosion 08.wav'
clip('gun-light', S, m4, ca, 1.02, .7, target=-20)
clip('gun-medium', S, 'Coll Anderson - Guns/EFX EXT .50 Cal Pistol Shots 02 A.wav', ca, 1.00, 1.6, rate=.72, target=-20)
clip('gun-heavy', S, mortar, ca, .26, 1.15, rate=.55, target=-20)
clip('torpedo-launch', H, 'SWSH_Anime Fly 1.wav', 'Helton Yan', 0, 1.1, rate=.75)
clip('missile-launch', K, 'Audio/thrusterFire_000.ogg', 'Kenney', 0, 1.5, target=-23)
clip('flak', S, m4, ca, 1.02, .4, rate=1.15, target=-23)
clip('zap', H, 'ELECSprk_Anime Spark 1.wav', 'Helton Yan', 0, .75)
clip('thunder', S, 'Soundopolis - Natures Fury_Thunder/Thunder_Rumble_Mid_Fienup_024.wav', 'Soundopolis / Jeff Fienup', 0, 4.4)
clip('laser', H, 'MAGSpel_Anime Ability Release 2.wav', 'Helton Yan', 0, 2.4)
clip('nuke', H, 'EXPLDsgn_Anime Explosion 11.wav', 'Helton Yan', 0, 3.8, rate=.8, target=-23)
clip('ricochet', S, plate, ca, .30, 1.2, rate=1.7, highpass=650, target=-25)
clip('collapse', S, 'Coll Anderson - Car Destruction/EFX EXT Metal Impact Smash Move 07 B.M.wav', ca, 3.86, 1.7, rate=.7)
clip('ui-click', S, click, eir, 0, .21, target=-26)
clip('ui-ribbon', S, 'Membrans - Spaceship Interface Sound Pack 01/Spaceship Interface 74.wav', 'Membrans', 0, .36, target=-25)
clip('ui-alarm', S, 'SoundMorph - Users of Tommorow/alarm_loops_08.wav', 'SoundMorph', 0, 1.65, target=-24)
clip('ui-ability', H, 'MAGSpel_Anime Ability Ready 1.wav', 'Helton Yan', 0, 1.0, target=-24)
clip('ui-ult', H, 'MAGSpel_Anime Ability Charge 8.wav', 'Helton Yan', 0, 1.4, target=-23)
clip('ui-capture', S, beep, 'SoundMorph', 0, .9, target=-24)
clip('ui-victory', S, ton, eir, 0, .5, sequence=[(0, 0), (4, .22), (7, .44), (12, .68)], target=-24)
clip('ui-defeat', S, ton, eir, 0, .6, sequence=[(0, 0), (-3, .3), (-7, .6)], target=-25)
clip('ui-citadel', K, 'Audio/impactMetal_000.ogg', 'Kenney', 0, .35, target=-22)
clip('ui-warning', S, 'SoundMorph - Users of Tommorow/alarm_loops_08.wav', 'SoundMorph', 0, .5, rate=.78, target=-26)
clip('ui-pickup', H, 'MAGSpel_Anime Ability Ready 3.wav', 'Helton Yan', 0, .9, target=-25)
clip('ui-siren', S, 'Coll Anderson - Traditional Sirens/EFX EXT Emergency Siren 10 B.wav', ca, 0, 2.8, rate=.8, target=-24)
clip('ui-horn', S, 'Secret Source - 002 1964 Mercury Montclair /AUTO_64MM445-MM065_Ext_Doppler_Horns_W_Eng.wav', 'Secret Source', 7.45, 1.1, rate=.6, lowpass=2200, target=-24)
clip('ui-heartbeat', S, plate, ca, .30, .16, rate=.45, lowpass=110, sequence=[(0, 0), (-2, .22)], target=-26)
clip('ui-ult-ready', H, 'MAGSpel_Anime Ability Ready 5.wav', 'Helton Yan', 0, .9, target=-24)
clip('ui-streak', S, ton, eir, 0, .4, sequence=[(0, 0), (7, .2)], target=-25)
clip('ui-unshift', H, 'MAGSpel_Anime Ability Ready 8.wav', 'Helton Yan', 0, 2.65, reverse=True, target=-24)
clip('ambience-sea', S, 'Soundopolis - Water Ambiences 01/Beach_Ocean_Waves_Fienup_001.wav', 'Soundopolis / Jeff Fienup', 8, 26, loop=2, target=-25)
clip('ambience-wind', S, 'Detunized - AroundBridges/Bridges-Wind08.wav', 'Detunized', 2, 12, loop=1, target=-27)
clip('engine-naval', K, 'Audio/spaceEngineLow_002.ogg', 'Kenney', 0, 3, lowpass=800, loop=.3, target=-26)
clip('engine-ground', S, 'Carlo Ascrizzi - Race Cars Essential Library/Engine,Start,Accelerate,Stop,Hood_03.M.wav', 'Carlo Ascrizzi', 2.0, 3.0, lowpass=1600, loop=.3, target=-25)
replaced = {e['file'] for e in entries}
manifest = [e for e in manifest if e['file'] not in replaced] + entries
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
