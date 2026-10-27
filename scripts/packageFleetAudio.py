import zipfile,subprocess,json,argparse,tempfile
from pathlib import Path
parser=argparse.ArgumentParser(description='Package the fleet audio expansion from licensed source packs. Run from the repository root.')
parser.add_argument('--anime-zip',required=True)
parser.add_argument('--kenney-dir',required=True,help='Extracted pack directory containing Audio/')
args=parser.parse_args()
scratch=tempfile.TemporaryDirectory(prefix='steel-fleet-audio-')
z=zipfile.ZipFile(args.anime_zip);out=Path('public/audio');manifest=json.loads((out/'manifest.json').read_text())
items=[('arcane-charge','MAGSpel_Anime Ability Charge 5.wav',1.65),('energy-charge','MAGSpel_Anime Ability Charge 12.wav',1.8),('energy-heavy','MAGSpel_Anime Ability Release 5.wav',2.1),('energy-pulse','MAGSpel_Anime Ability Release 9.wav',1.3),('cut-heavy','FGHTClth_Anime Swing 3.wav',.65),('cut-light','FGHTClth_Anime Swing 2.wav',.55),('blast-heavy','EXPLDsgn_Anime Explosion 4.wav',1.8),('blast-shock','EXPLDsgn_Anime Explosion 7.wav',1.4),('ward-rise','MAGSpel_Anime Ability Ready 6.wav',1.4),('phase-arrival','MAGSpel_Anime Ability Ready 7.wav',1.2)]
for name,src,duration in items:
 path=Path(scratch.name)/src;path.write_bytes(z.read(src));dest=out/(name+'.m4a')
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-vn','-t',str(duration),'-af',f'afade=t=out:st={duration-.08}:d=0.08,loudnorm=I=-21:TP=-3:LRA=7','-ac','1','-ar','44100','-c:a','aac','-b:a','96k',str(dest)],check=True)
 manifest=[r for r in manifest if r['file']!=dest.name]
 manifest.append(dict(file=dest.name,sourceFile=src,author='Helton Yan',source='https://heltonyan.itch.io/retroanimesfx',license='CC BY 4.0',licenseUrl='https://creativecommons.org/licenses/by/4.0/',modifications=f'First {duration}s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s.',sourceCrc32=f'{z.getinfo(src).CRC:08x}'))
for name,src in [('sensor-ping','computerNoise_002.ogg'),('mechanical-hit','impactMetal_003.ogg'),('plasma-shot','laserLarge_002.ogg'),('jet-release','thrusterFire_002.ogg')]:
 path=Path(args.kenney_dir)/'Audio'/src;dest=out/(name+'.m4a');subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-vn','-af','loudnorm=I=-21:TP=-3:LRA=7','-ac','1','-ar','44100','-c:a','aac','-b:a','96k',str(dest)],check=True)
 manifest=[r for r in manifest if r['file']!=dest.name]
 manifest.append(dict(file=dest.name,sourceFile='Audio/'+src,author='Kenney',source='https://kenney.nl/assets/sci-fi-sounds',license='CC0 1.0',licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',modifications='-21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s.'))
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Packaged',len(items)+4,'additional recordings')

z.close()
scratch.cleanup()
