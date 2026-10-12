import { useRef, useState } from 'react';
import { Archive, X, Download, Upload, FileCheck2, LoaderCircle, CheckCircle2, FileText, MessageSquare, Highlighter, AlertCircle } from 'lucide-react';
import { exportBackup, inspectBackup, previewBackup, restoreBackup, downloadBackup } from '../lib/storage';
import type { BackupArchive, BackupPreview } from '../lib/storage';
import './BackupManager.css';
import AutomaticBackups from './AutomaticBackups';

interface Props { onClose: () => void; onRestored: () => void; onNotify?: (message: string) => void; }
export default function BackupManager({ onClose, onRestored, onNotify }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [archive, setArchive] = useState<BackupArchive | null>(null), [preview, setPreview] = useState<BackupPreview | null>(null), [fileName, setFileName] = useState('');
  const [conflicts, setConflicts] = useState<'skip' | 'replace'>('skip'), [backupFirst, setBackupFirst] = useState(true);
  async function doExport() {
    setBusy('正在打包 PDF、解析与阅读记录…'); setError(''); setSuccess('');
    try { const result = await exportBackup(); downloadBackup(result.blob, result.fileName); setSuccess(`已导出 ${result.paperCount} 篇文献的完整备份`); onNotify?.('文献库备份已生成'); }
    catch (err) { setError((err as Error).message || '备份失败，请检查可用存储空间。'); } finally { setBusy(''); }
  }
  async function chooseFile(file?: File) {
    if (!file) return; setBusy('正在读取备份清单…'); setError(''); setSuccess(''); setArchive(null); setPreview(null);
    try { const incoming = await inspectBackup(file), details = await previewBackup(incoming); setArchive(incoming); setPreview(details); setFileName(file.name); setConflicts('skip'); }
    catch (err) { setError((err as Error).message || '备份文件无法读取。'); } finally { setBusy(''); if (input.current) input.current.value = ''; }
  }
  async function doRestore() {
    if (!archive) return;
    setBusy('正在校验备份内容…'); setError(''); setSuccess('');
    try {
      if (backupFirst) { setBusy('正在为当前文献库生成恢复前备份…'); const snapshot = await exportBackup(); downloadBackup(snapshot.blob, snapshot.fileName.replace('.paperlens', '-恢复前.paperlens')); }
      setBusy('正在恢复文献、PDF 和阅读记录…');
      const result = await restoreBackup(archive, { conflicts });
      const message = `已恢复 ${result.restored} 篇文献${result.replaced ? `，更新 ${result.replaced} 篇已有记录` : ''}${result.skipped ? `，保留 ${result.skipped} 篇本机已有记录` : ''}`;
      setSuccess(message + (result.jobs ? `；后台任务新增 ${result.jobs.restored}、更新 ${result.jobs.replaced}、保留 ${result.jobs.skipped} 项` : '')); if (result.warnings?.length) setError(result.warnings.join(' ')); onNotify?.(result.warnings?.length ? '文献已恢复，后台任务需要重试；请查看备份窗口中的提示' : message); onRestored(); if (!result.warnings?.length) { setArchive(null); setPreview(null); }
    } catch (err) { setError((err as Error).message || '恢复失败，请检查备份文件和可用空间。'); } finally { setBusy(''); }
  }
  return <div className="modal-backdrop backup-backdrop" onClick={() => { if (!busy) onClose(); }}><section className="backup-manager" role="dialog" aria-modal="true" aria-labelledby="backup-title" onClick={e => e.stopPropagation()}>
    <header className="backup-header"><div className="backup-icon"><Archive size={23}/></div><div><h2 id="backup-title">备份与恢复</h2><p>把原文、解析和阅读积累一起带走</p></div><button className="icon-btn" title="关闭备份与恢复" disabled={!!busy} onClick={onClose}><X size={20}/></button></header>
    <div className="backup-scroll"><div className="backup-includes"><span><FileText size={15}/>原始 PDF 与解析</span><span><Highlighter size={15}/>高亮、书签与子图</span><span><MessageSquare size={15}/>笔记、聊天与修订</span><span><Archive size={15}/>标签、分区与任务检查点</span></div>
      <div className="backup-actions-grid"><section><div className="backup-action-heading"><Download size={21}/><h3>导出完整文献库</h3></div><p>生成压缩备份文件，可在另一台电脑的 PaperRead 中恢复。</p><button className="primary-button" disabled={!!busy} onClick={doExport}><Download size={15}/>下载完整备份</button></section><section><div className="backup-action-heading"><Upload size={21}/><h3>从备份恢复</h3></div><p>先预览文献数量与重复记录，再选择合并方式。</p><button className="backup-import-button" disabled={!!busy} onClick={() => input.current?.click()}><Upload size={15}/>选择备份文件</button><input ref={input} type="file" hidden accept=".gz,.json,.paperlens" aria-label="选择 PaperRead 备份文件" onChange={e => chooseFile(e.target.files?.[0])}/></section></div>
      <AutomaticBackups disabled={!!busy} onChoose={file=>void chooseFile(file)}/>
      {preview && <section className="backup-preview"><div className="backup-file"><FileCheck2 size={20}/><div><strong>{fileName}</strong><small>备份于 {new Date(preview.createdAt).toLocaleString('zh-CN')} · PDF 约 {(preview.byteCount / 1024 / 1024).toFixed(1)} MB</small></div></div><div className="backup-counts"><div><strong>{preview.paperCount}</strong><span>篇文献</span></div><div><strong>{preview.pdfCount}</strong><span>份 PDF</span></div><div><strong>{preview.annotationCount}</strong><span>份标注记录</span></div><div><strong>{preview.chatCount}</strong><span>份聊天记录</span></div><div><strong>{preview.jobCount}</strong><span>项后台任务</span></div></div>
        {!!preview.missingPdfCount && <p className="backup-warning"><AlertCircle size={15}/>{preview.missingPdfCount} 篇文献在备份中没有原始 PDF，只恢复解析与笔记。</p>}
        <fieldset disabled={!!busy}><legend>已有 {preview.conflictCount} 篇相同编号的文献，如何合并？</legend><label><input type="radio" name="backup-conflicts" checked={conflicts === 'skip'} onChange={() => setConflicts('skip')}/><span><strong>保留本机记录</strong><small>仅添加尚未存在的文献；已有聊天、标注和偏好保持不变。</small></span><span className="backup-recommended">默认</span></label><label><input type="radio" name="backup-conflicts" checked={conflicts === 'replace'} onChange={() => setConflicts('replace')}/><span><strong>使用备份中的记录</strong><small>相同编号的文献及同名设置由备份替换，其余文献保留。</small></span></label></fieldset>
        <label className="backup-first"><input type="checkbox" checked={backupFirst} onChange={e => setBackupFirst(e.target.checked)} disabled={!!busy}/>恢复前，先下载当前文献库的完整备份</label><button className="primary-button backup-restore" disabled={!!busy} onClick={doRestore}><Upload size={15}/>{conflicts === 'replace' ? '按所选方式恢复' : '合并恢复'}</button>
      </section>}
      {busy && <div className="backup-status" role="status"><LoaderCircle size={17} className="spin"/>{busy}</div>}
      {error && <div className="backup-error" role="alert"><AlertCircle size={16}/>{error}</div>}
      {success && <div className="backup-success" role="status"><CheckCircle2 size={16}/>{success}</div>}
      <p className="backup-footnote">API 密钥不会写入备份，恢复不会覆盖本机密钥。后台任务包含已完成分段的检查点，未完成任务恢复为暂停状态，可在任务中心继续。当前支持最大 1 GB 的备份文件。</p>
    </div>
  </section></div>;
}
