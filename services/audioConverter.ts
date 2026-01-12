
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export const loadFFmpeg = async () => {
  if (ffmpeg) return ffmpeg;
  
  ffmpeg = new FFmpeg();
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
};

export const convertWmaToMp3 = async (
  file: File, 
  onProgress: (progress: number) => void
): Promise<Blob> => {
  const instance = await loadFFmpeg();
  const inputName = 'input.wma';
  const outputName = 'output.mp3';

  instance.on('progress', ({ progress }) => {
    onProgress(progress * 100);
  });

  await instance.writeFile(inputName, await fetchFile(file));
  
  // Convert to 192kbps MP3
  await instance.exec(['-i', inputName, '-b:a', '192k', outputName]);
  
  const data = await instance.readFile(outputName);
  return new Blob([(data as Uint8Array).buffer], { type: 'audio/mpeg' });
};

/**
 * 長い音声を一定時間ごとに分割する（オプション用）
 */
export const splitMp3 = async (
  file: File | Blob, 
  segmentTime: number, // 秒
  onProgress: (progress: number) => void
): Promise<Blob[]> => {
  const instance = await loadFFmpeg();
  const inputName = 'input_large.mp3';
  
  await instance.writeFile(inputName, await fetchFile(file));
  
  // %03d.mp3 形式で連番出力
  await instance.exec([
    '-i', inputName, 
    '-f', 'segment', 
    '-segment_time', segmentTime.toString(), 
    '-c', 'copy', 
    'out%03d.mp3'
  ]);

  const files = await instance.listDir('.');
  const blobs: Blob[] = [];
  
  for (const f of files) {
    if (f.name.startsWith('out') && f.name.endsWith('.mp3')) {
      const data = await instance.readFile(f.name);
      blobs.push(new Blob([(data as Uint8Array).buffer], { type: 'audio/mpeg' }));
      await instance.deleteFile(f.name);
    }
  }
  
  return blobs;
};
