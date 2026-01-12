
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
  await instance.exec(['-i', inputName, '-b:a', '192k', outputName]);
  
  const data = await instance.readFile(outputName);
  return new Blob([(data as Uint8Array).buffer], { type: 'audio/mpeg' });
};

/**
 * 無音部分を検出して分割ポイント（秒）のリストを返す
 */
const detectSilencePoints = async (instance: FFmpeg, fileName: string): Promise<number[]> => {
  const silencePoints: number[] = [];
  const logHandler = ({ message }: { message: string }) => {
    // ログから silence_start と silence_end を探す
    // 例: [silencedetect @ 0x...] silence_start: 125.2
    const startMatch = message.match(/silence_start: ([\d.]+)/);
    const endMatch = message.match(/silence_end: ([\d.]+)/);
    
    if (startMatch) {
      silencePoints.push(parseFloat(startMatch[1]));
    }
    if (endMatch && silencePoints.length > 0) {
      // 開始と終了の中間点を分割点とする
      const start = silencePoints[silencePoints.length - 1];
      const end = parseFloat(endMatch[1]);
      silencePoints[silencePoints.length - 1] = (start + end) / 2;
    }
  };

  instance.on('log', logHandler);
  
  // 無音検出フィルタを実行 (2秒以上の無音、-30dB以下)
  await instance.exec([
    '-i', fileName, 
    '-af', 'silencedetect=noise=-30dB:d=2', 
    '-f', 'null', '-'
  ]);

  instance.off('log', logHandler);
  return silencePoints;
};

/**
 * 音声を分割する（固定時間 または 無音検出）
 */
export const splitMp3 = async (
  file: File | Blob, 
  mode: number | 'silence', 
  onProgress: (progress: number) => void
): Promise<Blob[]> => {
  const instance = await loadFFmpeg();
  const inputName = 'input_split.mp3';
  await instance.writeFile(inputName, await fetchFile(file));

  let splitArgs: string[] = [];

  if (mode === 'silence') {
    const points = await detectSilencePoints(instance, inputName);
    if (points.length === 0) return [new Blob([await file.arrayBuffer()], { type: 'audio/mpeg' })];
    
    // カンマ区切りのタイムスタンプ文字列を作成
    const timeStr = points.join(',');
    splitArgs = [
      '-i', inputName,
      '-f', 'segment',
      '-segment_times', timeStr,
      '-c', 'copy',
      'out%03d.mp3'
    ];
  } else {
    // 固定時間分割
    splitArgs = [
      '-i', inputName,
      '-f', 'segment',
      '-segment_time', mode.toString(),
      '-c', 'copy',
      'out%03d.mp3'
    ];
  }

  await instance.exec(splitArgs);

  const files = await instance.listDir('.');
  const blobs: Blob[] = [];
  
  // アルファベット順にソートして連番を維持
  const outFiles = files
    .filter(f => f.name.startsWith('out') && f.name.endsWith('.mp3'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const f of outFiles) {
    const data = await instance.readFile(f.name);
    blobs.push(new Blob([(data as Uint8Array).buffer], { type: 'audio/mpeg' }));
    await instance.deleteFile(f.name);
  }
  
  await instance.deleteFile(inputName);
  return blobs;
};
