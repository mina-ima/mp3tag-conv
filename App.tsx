
import React, { useState, useCallback, useRef } from 'react';
import { ProcessingFile, AppStatus } from './types.ts';
import { parseMetadata, fixFileTags, inferMetadataWithAI } from './services/id3Service.ts';
import { convertWmaToMp3, loadFFmpeg, splitMp3 } from './services/audioConverter.ts';
import JSZip from 'jszip';

const MusicIcon = () => (
  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
  </svg>
);

const SparklesIcon = () => (
  <svg className="w-4 h-4 text-amber-500 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
  </svg>
);

const ZipIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);

// Fix error in file App.tsx on line 322: Cannot find name 'CheckCircleIcon'.
const CheckCircleIcon = () => (
  <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [isZipping, setIsZipping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const [shouldOrganize, setShouldOrganize] = useState(true);
  const [splitDuration, setSplitDuration] = useState<number>(0); // 0 means no split
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const sanitizeFolderName = (name: string): string => {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Unknown';
  };

  const processFileEntry = async (entry: FileSystemEntry, path: string = ''): Promise<ProcessingFile[]> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise((resolve) => {
        fileEntry.file((file) => {
          const isMp3 = file.name.toLowerCase().endsWith('.mp3');
          const isWma = file.name.toLowerCase().endsWith('.wma');
          if (isMp3 || isWma) {
            const pathParts = path.split('/');
            const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : undefined;
            resolve([{
              id: Math.random().toString(36).substr(2, 9),
              file,
              name: file.name,
              isWma,
              folderName,
              status: 'pending',
              progress: 0
            }]);
          } else {
            resolve([]);
          }
        });
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      return new Promise((resolve) => {
        reader.readEntries(async (entries) => {
          const results = await Promise.all(
            entries.map((e) => processFileEntry(e, `${path}${entry.name}/`))
          );
          resolve(results.flat());
        });
      });
    }
    return [];
  };

  // Fix error in file App.tsx on line 216: Cannot find name 'handleDrop'.
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const items = e.dataTransfer.items;
    if (!items) return;

    const entryPromises: Promise<ProcessingFile[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = (item as any).webkitGetAsEntry();
        if (entry) {
          entryPromises.push(processFileEntry(entry));
        }
      }
    }

    const results = await Promise.all(entryPromises);
    const flattened = results.flat();
    setFiles(prev => [...prev, ...flattened]);
  }, []);

  const addFilesFromInput = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: ProcessingFile[] = Array.from(fileList)
      .filter(file => {
        const ext = file.name.toLowerCase();
        return ext.endsWith('.mp3') || ext.endsWith('.wma');
      })
      .map(file => {
        const ext = file.name.toLowerCase();
        let folderName: string | undefined = undefined;
        if ((file as any).webkitRelativePath) {
          const pathParts = (file as any).webkitRelativePath.split('/');
          if (pathParts.length > 1) folderName = pathParts[pathParts.length - 2];
        }
        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          name: file.name,
          isWma: ext.endsWith('.wma'),
          folderName,
          status: 'pending',
          progress: 0
        };
      });
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  // Fix error in file App.tsx on line 256: Cannot find name 'inferAllMetadata'.
  const inferAllMetadata = async () => {
    setIsInferring(true);
    const updatedFiles = [...files];
    for (let i = 0; i < updatedFiles.length; i++) {
      const f = updatedFiles[i];
      // Skip if already processed or if metadata is already present and likely fixed
      if (f.status === 'completed' || (f.metadata && f.metadata.title !== f.name.replace(/\.[^/.]+$/, ""))) continue;
      
      const inferred = await inferMetadataWithAI(f.name, f.folderName);
      if (Object.keys(inferred).length > 0) {
        updatedFiles[i] = {
          ...f,
          metadata: {
            title: inferred.title || f.name.replace(/\.[^/.]+$/, ""),
            artist: inferred.artist || "不明なアーティスト",
            album: inferred.album || f.folderName || "不明なアルバム",
            originalEncoding: 'Unknown'
          }
        };
      }
    }
    setFiles(updatedFiles);
    setIsInferring(false);
  };

  const startProcessing = async () => {
    setStatus(AppStatus.LOADING_FFMPEG);
    try {
      await loadFFmpeg();
    } catch (e) {
      alert("FFmpegのロードに失敗しました。このブラウザは対応していない可能性があります。");
      setStatus(AppStatus.IDLE);
      return;
    }
    
    setStatus(AppStatus.PROCESSING);
    
    for (const f of files) {
      if (f.status === 'completed') continue;
      
      let workingBlob: Blob = f.file;
      let workingName = f.name;

      // 1. Convert WMA to MP3 if needed
      if (f.isWma) {
        setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'converting' } : item));
        try {
          workingBlob = await convertWmaToMp3(f.file, (p) => {
            setFiles(prev => prev.map(item => item.id === f.id ? { ...item, progress: p } : item));
          });
          workingName = f.name.replace(/\.wma$/i, '.mp3');
        } catch (err) {
          setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'error', error: '変換失敗' } : item));
          continue;
        }
      }

      // 2. Metadata Handling
      setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'processing' } : item));
      try {
        const meta = f.metadata || await parseMetadata(new File([workingBlob], workingName), f.folderName);
        
        // 3. Optional Splitting
        if (splitDuration > 0) {
          // Splitting is complex for a batch UI, we handle it during ZIP generation 
          // but let's mark it here.
        }

        const finalBlob = await fixFileTags(new File([workingBlob], workingName), meta);
        
        setFiles(prev => prev.map(item => item.id === f.id ? { 
          ...item, 
          status: 'completed', 
          metadata: meta, 
          fixedBlob: finalBlob,
          name: workingName
        } : item));
      } catch (err) {
        setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'error', error: 'タグ失敗' } : item));
      }
    }
    setStatus(AppStatus.COMPLETED);
  };

  const downloadAsZip = async () => {
    const completedFiles = files.filter(f => f.status === 'completed' && f.fixedBlob);
    if (completedFiles.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      
      for (const f of completedFiles) {
        const artist = sanitizeFolderName(f.metadata?.artist || 'Unknown Artist');
        const album = sanitizeFolderName(f.metadata?.album || 'Unknown Album');
        const baseDir = shouldOrganize ? `${artist}/${album}/` : '';

        if (splitDuration > 0) {
          const segments = await splitMp3(f.fixedBlob!, splitDuration, () => {});
          segments.forEach((seg, idx) => {
            const partName = f.name.replace(/\.mp3$/, `_Part${idx + 1}.mp3`);
            zip.file(`${baseDir}${partName}`, seg);
          });
        } else {
          zip.file(`${baseDir}${f.name}`, f.fixedBlob!);
        }
      }
      
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `music_fixed_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("ZIP作成中にエラーが発生しました。");
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">🚗 Car Audio Utility</h1>
        <p className="text-slate-600 font-medium">WMAのMP3変換・長時間ファイルの分割・文字化け修正・フォルダ整理をブラウザで完結。</p>
      </header>

      <main className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDrop={handleDrop}
          className={`p-10 border-b border-slate-100 transition-all duration-300 ${isDragging ? 'bg-blue-50 border-blue-400' : 'bg-slate-50/50'}`}
        >
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className="p-4 rounded-full mb-4 bg-white shadow-sm"><MusicIcon /></div>
              <h2 className="text-xl font-semibold text-slate-700">MP3 / WMAをドロップ</h2>
              <p className="text-slate-400 text-sm mt-1">フォルダごとのドラッグ＆ドロップにも対応しています</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-blue-500 hover:text-blue-600 transition-all font-medium text-slate-600 shadow-sm">ファイル選択</button>
              <button onClick={() => folderInputRef.current?.click()} className="flex-1 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:text-emerald-600 transition-all font-medium text-slate-600 shadow-sm">フォルダ選択</button>
            </div>
          </div>
          <input type="file" ref={fileInputRef} onChange={(e) => addFilesFromInput(e.target.files)} multiple accept=".mp3,.wma" className="hidden" />
          <input type="file" ref={folderInputRef} onChange={(e) => addFilesFromInput(e.target.files)} {...({ webkitdirectory: "", directory: "" } as any)} className="hidden" />
        </div>

        {files.length > 0 && (
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                <span className="text-xs font-bold text-slate-500">分割設定:</span>
                <select 
                  value={splitDuration} 
                  onChange={(e) => setSplitDuration(Number(e.target.value))}
                  className="text-xs font-bold text-slate-700 bg-transparent outline-none focus:text-blue-600"
                >
                  <option value={0}>分割しない</option>
                  <option value={600}>10分ごとに分割</option>
                  <option value={1800}>30分ごとに分割</option>
                  <option value={3600}>1時間ごとに分割</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" checked={shouldOrganize} onChange={(e) => setShouldOrganize(e.target.checked)} className="w-4 h-4 text-blue-600 rounded border-slate-300" />
                <span className="text-xs font-bold text-slate-600 group-hover:text-blue-600">フォルダ自動整理</span>
              </label>

              <button onClick={inferAllMetadata} disabled={isInferring || status === AppStatus.PROCESSING} className="flex items-center gap-1.5 text-xs font-bold text-amber-600 hover:text-amber-700 disabled:opacity-50">
                <SparklesIcon /> {isInferring ? 'AI解析中...' : 'AIタグ補完'}
              </button>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-400">{files.length} ファイルを選択中</span>
              <div className="flex gap-2">
                {status !== AppStatus.COMPLETED ? (
                  <button onClick={startProcessing} disabled={status === AppStatus.PROCESSING || status === AppStatus.LOADING_FFMPEG} className="px-8 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg disabled:bg-slate-300">
                    {status === AppStatus.LOADING_FFMPEG ? 'システム準備中...' : status === AppStatus.PROCESSING ? '処理中...' : '処理を開始'}
                  </button>
                ) : (
                  <>
                    <button onClick={() => setFiles([])} className="px-4 py-2.5 text-sm font-bold text-slate-500">クリア</button>
                    <button onClick={downloadAsZip} disabled={isZipping} className="flex items-center px-8 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg disabled:bg-slate-300">
                      <ZipIcon /> {isZipping ? '圧縮中...' : 'ZIPをダウンロード'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white border-b border-slate-200 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase">ファイル</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase">メタデータ</th>
                <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase">ステータス</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {files.map(f => (
                <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${f.isWma ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                        {f.isWma ? 'WMA' : 'MP3'}
                      </span>
                      <span className="text-sm text-slate-700 truncate max-w-[200px]">{f.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    {f.metadata ? (
                      <div className="text-[11px]">
                        <div className="font-bold text-slate-800">{f.metadata.title}</div>
                        <div className="text-slate-500">{f.metadata.artist} / {f.metadata.album}</div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-300 italic">準備完了</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      {f.status === 'converting' && (
                        <div className="flex items-center gap-2 w-full">
                          <div className="h-1.5 w-16 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all" style={{ width: `${f.progress}%` }}></div>
                          </div>
                          <span className="text-[10px] text-orange-600 font-bold">変換中...</span>
                        </div>
                      )}
                      {f.status === 'processing' && <span className="text-[10px] text-blue-500 font-bold animate-pulse">タグ書込中...</span>}
                      {f.status === 'completed' && <CheckCircleIcon />}
                      {f.status === 'error' && <span className="text-[10px] text-red-500">{f.error}</span>}
                      {f.status === 'pending' && <span className="text-[10px] text-slate-400">待機</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
        <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
        <div className="text-xs text-blue-700 leading-relaxed">
          <strong>ヒント:</strong> WMAファイルが含まれている場合、初回のみ処理開始に時間がかかることがあります（変換システムの読み込み）。長時間ファイルは「分割設定」を有効にすることで、カーオーディオでのシーク操作が楽になります。
        </div>
      </div>
    </div>
  );
};

export default App;
