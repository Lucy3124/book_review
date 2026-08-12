import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, Check, ChevronLeft, ChevronRight, Database, Download,
  ArrowRight, FileSearch, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck,
  Upload, X, LogOut, Trash2, Pencil, Save
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "请求失败");
  }
  return response.json();
}

const statusClass = { 待复核: "blue", 审读中: "amber", 排队中: "amber", 已完成: "green", 待审读: "gray", 审读失败: "red" };
const levelClass = { 明确差错: "red", 疑似差错: "amber", 高风险待专家判断: "purple" };

function Sidebar({ view, setView, user, onLogout }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">鉴</div><div><strong>稿鉴</strong><span>AI书稿审读</span></div></div>
    <nav>
      <button className={view === "books" || view === "review" ? "active" : ""} onClick={() => setView("books")}><BookOpen />书稿审读</button>
      <button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")}><Database />权威资料库</button>
    </nav>
    <div className="sidebar-bottom">
      <div className="user"><div>{user.phone.slice(-2)}</div><span><strong>{user.phone}</strong></span><button className="logout-button" onClick={onLogout} title="退出登录"><LogOut /></button></div>
    </div>
  </aside>;
}

function Header({ title, subtitle, actions }) {
  return <header className="topbar"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions">{actions}</div></header>;
}

function UploadDialog({ onClose, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!files.length) return;
    if (files.some((file) => file.size > 200 * 1024 * 1024)) { setError("单个文件不能超过200 MB"); return; }
    setBusy(true); setError("");
    const form = new FormData(); files.forEach((file) => form.append("files", file));
    try {
      await api("/api/books/batch", { method: "POST", body: form });
      onUploaded();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-title"><div><h2>批量上传书稿</h2><p>上传后将分别启动审读任务</p></div><button className="icon-button" onClick={onClose} title="关闭"><X /></button></div>
    <label className={`dropzone ${files.length ? "selected" : ""}`}>
      <input type="file" multiple accept="application/pdf" onChange={(e) => setFiles(Array.from(e.target.files))} />
      <Upload />
      {files.length ? <><strong>已选择 {files.length} 个PDF</strong><span>{files.map((file) => file.name).join("、")}</span></> : <><strong>选择一个或多个PDF书稿</strong><span>单个文件不超过200 MB</span></>}
    </label>
    {error && <div className="error-message">{error}</div>}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!files.length || busy} onClick={submit}>{busy ? <LoaderCircle className="spin" /> : <Upload />}上传并审读</button></div>
  </div></div>;
}

function BooksView({ openBook }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  async function load() {
    setLoading(true);
    setLoadError("");
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        setBooks(await api("/api/books"));
        setLoading(false);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    setLoadError(lastError.message);
    setLoading(false);
  }
  async function deleteBook() {
    setDeleting(true);
    await api(`/api/books/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    setDeleting(false);
    await load();
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query]);
  const filtered = books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visibleBooks = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  return <main className="main">
    <Header title="书稿审读" subtitle={`${books.length} 本书稿`} actions={<button className="primary" onClick={() => setShowUpload(true)}><Plus />上传书稿</button>} />
    <div className="content">
      <div className="toolbar"><div className="search"><Search /><input placeholder="搜索书稿名称" value={query} onChange={(e) => setQuery(e.target.value)} /></div><button className="icon-button outlined" onClick={load} title="刷新"><RefreshCw /></button></div>
      <div className="table-shell">
        <table><thead><tr><th>书稿</th><th>正文范围</th><th>字数</th><th>发现问题</th><th>已确认</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>{visibleBooks.map((book) => <tr key={book.id} onClick={() => openBook(book.id)}>
          <td><div className="book-cell"><div className="book-icon"><FileSearch /></div><span><strong>{book.title}</strong><small>{book.filename}</small></span></div></td>
          <td>{book.start_page && book.end_page ? `${book.start_page}–${book.end_page} / ${book.page_count}页` : `共${book.page_count}页`}</td>
          <td>{book.char_count.toLocaleString()}</td><td>{book.finding_count}</td><td>{book.confirmed_count}</td>
          <td><span className={`badge ${statusClass[book.status] || "gray"}`}>{book.status}</span></td><td>{new Date(book.updated_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td><button className="icon-button delete-button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(book); }} title="删除审读记录"><Trash2 /></button></td>
        </tr>)}</tbody></table>
        {loading && <div className="empty"><LoaderCircle className="spin" /><strong>正在加载书稿</strong></div>}
        {!loading && loadError && <div className="empty page-error"><AlertTriangle /><strong>书稿加载失败</strong><span>{loadError}</span><button onClick={load}>重新加载</button></div>}
        {!loading && !loadError && !filtered.length && <div className="empty"><FileSearch /><strong>暂无书稿</strong><span>上传PDF后开始审读</span></div>}
      </div>
      {!loading && !loadError && filtered.length > 10 && <div className="pagination"><span>共 {filtered.length} 条</span><button className="icon-button outlined" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} title="上一页"><ChevronLeft /></button><strong>{currentPage} / {pageCount}</strong><button className="icon-button outlined" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} title="下一页"><ChevronRight /></button></div>}
    </div>
    {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />}
    {deleteTarget && <div className="modal-backdrop"><div className="modal confirm-modal">
      <div className="confirm-icon"><AlertTriangle /></div>
      <h2>删除审读记录</h2>
      <p>确定删除《{deleteTarget.title}》吗？<br />书稿文件、审读任务和全部审读结果都将被删除。</p>
      <div className="modal-actions"><button className="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="delete-confirm" disabled={deleting} onClick={deleteBook}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />}删除</button></div>
    </div></div>}
  </main>;
}

function SetupReview({ book, onStart }) {
  const [start, setStart] = useState(book.start_page || 1);
  const [end, setEnd] = useState(book.end_page || book.page_count);
  const [busy, setBusy] = useState(false);
  async function startReview() { setBusy(true); await onStart(start, end); }
  return <div className="setup-wrap"><div className="setup-panel">
    <div className="setup-heading"><ShieldCheck /><div><h2>设置正文范围</h2><p>{book.page_count} 页 · {book.char_count.toLocaleString()} 字</p></div></div>
    <div className="range-grid"><label className="field"><span>正文起始页</span><input type="number" min="1" max={book.page_count} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label><label className="field"><span>正文结束页</span><input type="number" min="1" max={book.page_count} value={end} onChange={(e) => setEnd(Number(e.target.value))} /></label></div>
    <div className="review-scope"><h3>本次审读范围</h3><div className="scope-grid"><span>法规与政策</span><span>文字</span><span>词语</span><span>科技名词</span><span>语法</span><span>标点符号</span><span>知识性</span></div></div>
    <button className="primary wide" onClick={startReview} disabled={busy || start > end}>{busy ? <LoaderCircle className="spin" /> : <FileSearch />}开始AI审读</button>
  </div></div>;
}

function PdfPage({ url, pageNumber, findings, selectedId, onSelect }) {
  const canvasRef = useRef(null);
  const shellRef = useRef(null);
  const [document, setDocument] = useState(null);
  const [size, setSize] = useState({ width: 1, height: 1, scale: 1 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const task = pdfjs.getDocument({ url });
    let cancelled = false;
    task.promise.then((loadedDocument) => { if (!cancelled) setDocument(loadedDocument); });
    return () => { cancelled = true; setDocument(null); task.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const available = Math.max(320, (shellRef.current?.clientWidth || 700) - 56);
      const scale = Math.min(1.45, available / base.width);
      const viewport = page.getViewport({ scale });
      if (cancelled) return;
      const canvas = canvasRef.current;
      canvas.width = viewport.width * window.devicePixelRatio;
      canvas.height = viewport.height * window.devicePixelRatio;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport, transform: [window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0] }).promise;
      if (!cancelled) { setSize({ width: viewport.width, height: viewport.height, scale }); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [document, pageNumber]);
  const pageMarks = findings.flatMap((finding) => finding.locations.filter((loc) => loc.page === pageNumber).map((loc, index) => ({ finding, loc, key: `${finding.id}-${index}` })));
  return <div className="pdf-stage" ref={shellRef}>{loading && <LoaderCircle className="spin pdf-loader" />}<div className="pdf-page" style={{ width: size.width, height: size.height }}><canvas ref={canvasRef} />{pageMarks.map(({ finding, loc, key }) => <button key={key} type="button" className={`pdf-underline ${selectedId === finding.id ? "selected" : ""}`} title={`${finding.category}：${finding.quote}`} aria-label={`查看错误：${finding.quote}`} onClick={() => onSelect(finding)} style={{ left: loc.x * size.scale, top: loc.y * size.scale, width: Math.max(8, loc.width * size.scale), height: Math.max(10, loc.height * size.scale) }} />)}</div></div>;
}

function ReviewView({ bookId, back }) {
  const [book, setBook] = useState(null);
  const [meta, setMeta] = useState(null);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("全部问题");
  const [status, setStatus] = useState("全部状态");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [editedText, setEditedText] = useState("");
  const findingRefs = useRef(new Map());
  async function load() {
    const data = await api(`/api/books/${bookId}`); setBook(data);
    if (selected) setSelected(data.findings.find((item) => item.id === selected.id) || null);
    return data;
  }
  useEffect(() => {
    Promise.all([
      load().then((data) => setPage(data.findings[0]?.page_number || data.start_page || 1)),
      api("/api/meta").then(setMeta)
    ]);
  }, [bookId]);
  useEffect(() => {
    if (!book?.task || ["已完成", "失败"].includes(book.task.status)) return;
    const timer = setInterval(load, 1600); return () => clearInterval(timer);
  }, [book?.task?.status]);
  const findings = useMemo(() => (book?.findings || []).filter((item) => (category === "全部问题" || item.category === category) && (status === "全部状态" || item.review_status === status) && (!query || `${item.quote}${item.explanation}`.includes(query))), [book, category, status, query]);
  useEffect(() => {
    if (!selected) return;
    findingRefs.current.get(selected.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected?.id, findings.length]);
  if (!book || !meta) return <main className="main loading"><LoaderCircle className="spin" /></main>;
  async function startReview(start_page, end_page) { await api(`/api/books/${bookId}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start_page, end_page }) }); await load(); }
  async function updateFinding(finding, reviewStatus) {
    await api(`/api/findings/${finding.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ review_status: reviewStatus }) });
    const data = await load();
    setSelected(data.findings.find((item) => item.id === finding.id) || null);
  }
  async function saveSuggestion() {
    await api(`/api/findings/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ editor_suggestion: editedText }) });
    setEditing(null);
    const data = await load();
    setSelected(data.findings.find((item) => item.id === editing.id) || null);
  }
  function selectFromPdf(finding) {
    setCategory("全部问题");
    setStatus("全部状态");
    setQuery("");
    setSelected(finding);
    setPage(finding.page_number);
  }
  const taskRunning = book.task && !["已完成", "失败"].includes(book.task.status);
  const pendingCount = book.findings.filter((item) => item.review_status === "待判断").length;
  const exportParams = new URLSearchParams();
  if (category !== "全部问题") exportParams.set("category", category);
  if (status !== "全部状态") exportParams.set("status", status);
  if (query) exportParams.set("query", query);
  const exportUrl = `/api/books/${book.id}/export${exportParams.size ? `?${exportParams}` : ""}`;
  return <main className="main review-main">
    <Header title={book.title} subtitle={`${book.start_page || 1}–${book.end_page || book.page_count}页 · ${book.char_count.toLocaleString()}字`} actions={<><button className="secondary" onClick={back}><ChevronLeft />返回书稿</button><a className="secondary" href={`/api/books/${book.id}/confirmed-word`}><Download />导出确认版本Word</a>{book.findings.length > 0 && <><a className="secondary" href={`/api/books/${book.id}/annotated-pdf`}><Download />导出划线PDF</a><a className="primary" href={exportUrl}><Download />导出Excel</a></>}</>} />
    {!book.task && <SetupReview book={book} onStart={startReview} />}
    {taskRunning && <div className="progress-screen"><div className="progress-panel"><LoaderCircle className="spin" /><h2>{book.task.stage}</h2><div className="progress-track"><i style={{ width: `${book.task.progress}%` }} /></div><strong>{book.task.progress}%</strong><p>任务在后台持续运行</p></div></div>}
    {book.task?.status === "失败" && <div className="progress-screen"><div className="progress-panel error"><AlertTriangle /><h2>审读失败</h2><p>{book.task.error}</p><button className="primary" onClick={() => startReview(book.start_page, book.end_page)}><RefreshCw />重新审读</button></div></div>}
    {book.task?.status === "已完成" && <div className="review-workspace">
      <section className="document-pane">
        <div className="document-toolbar"><button className="icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)} title="上一页"><ChevronLeft /></button><span>第 <input type="number" min="1" max={book.page_count} value={page} onChange={(e) => setPage(Math.min(book.page_count, Math.max(1, Number(e.target.value))))} /> / {book.page_count} 页</span><button className="icon-button" disabled={page >= book.page_count} onClick={() => setPage(page + 1)} title="下一页"><ChevronRight /></button></div>
        <PdfPage url={book.pdf_url} pageNumber={page} findings={book.findings} selectedId={selected?.id} onSelect={selectFromPdf} />
      </section>
      <aside className="findings-pane">
        <div className="summary-strip"><div><strong>{book.findings.length}</strong><span>AI发现</span></div><div className="risk"><strong>{pendingCount}</strong><span>待判断</span></div><div><strong>{book.findings.filter((i) => i.review_status === "已确认").length}</strong><span>已确认</span></div></div>
        <div className="finding-filters"><div className="search compact"><Search /><input placeholder="搜索内容" value={query} onChange={(e) => setQuery(e.target.value)} /></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option>全部状态</option>{meta.reviewStatuses.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="category-tabs"><button className={category === "全部问题" ? "active" : ""} onClick={() => setCategory("全部问题")}>全部 <b>{book.findings.length}</b></button>{meta.taxonomy.map((group) => <button key={group.name} className={category === group.name ? "active" : ""} onClick={() => setCategory(group.name)}><i style={{ background: group.color }} />{group.name.replace("类差错", "").replace("差错", "")} <b>{book.findings.filter((item) => item.category === group.name).length}</b></button>)}</div>
        <div className="finding-body"><div className="finding-list">{findings.map((finding) => <div ref={(node) => { if (node) findingRefs.current.set(finding.id, node); else findingRefs.current.delete(finding.id); }} className={`finding-item ${selected?.id === finding.id ? "selected" : ""}`} key={finding.id}><div className="finding-row" onClick={() => { setSelected(finding); setPage(finding.page_number); }}><span className={`finding-dot ${levelClass[finding.finding_level]}`} /><span className="finding-copy"><span className="finding-head"><span className="finding-change"><strong>{finding.quote}</strong><ArrowRight /><strong>{finding.editor_suggestion || finding.suggestion || "需编辑确认"}</strong></span><span className="finding-meta"><em>第{finding.page_number}页</em><i className={`review-mark ${finding.review_status === "已确认" ? "done" : finding.review_status === "已忽略" ? "rejected" : ""}`}>{finding.review_status}</i></span></span><span className="finding-field"><b>错误类型：</b>{finding.category}（{finding.subcategory}）</span><span className="finding-field"><b>错误说明：</b>{finding.explanation}</span></span></div><div className="inline-decision"><button className="secondary" onClick={() => { setEditing(finding); setEditedText(finding.editor_suggestion || finding.suggestion || ""); }}><Pencil />修改</button><button className={finding.review_status === "已忽略" ? "danger-outline active" : "danger-outline"} onClick={() => updateFinding(finding, "已忽略")}><X />忽略</button><button className={finding.review_status === "待判断" ? "secondary active" : "secondary"} onClick={() => updateFinding(finding, "待判断")}><AlertTriangle />待判断</button><button className={finding.review_status === "已确认" ? "confirm active" : "confirm"} onClick={() => updateFinding(finding, "已确认")}><Check />确认</button></div></div>)}{!findings.length && <div className="empty compact-empty"><Check /><strong>暂无错误内容</strong></div>}</div></div>
      </aside>
    </div>}
    {editing && <div className="modal-backdrop"><div className="modal"><div className="modal-title"><div><h2>修改正确文本</h2><p>保存后将优先使用人工编辑内容</p></div><button className="icon-button" onClick={() => setEditing(null)} title="关闭"><X /></button></div><label className="field"><span>正确文本</span><textarea value={editedText} onChange={(event) => setEditedText(event.target.value)} /></label><div className="modal-actions"><button className="secondary" onClick={() => setEditing(null)}>取消</button><button className="primary" disabled={!editedText.trim()} onClick={saveSuggestion}><Save />保存</button></div></div></div>}
  </main>;
}

function SourcesView() {
  const [sources, setSources] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", category: "法规政策" });
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function load() { setSources(await api("/api/sources")); }
  useEffect(() => { load(); }, []);
  async function add() { try { await api("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); setShowAdd(false); setForm({ name: "", url: "", category: "法规政策" }); load(); } catch (err) { setError(err.message); } }
  async function sync(id) { setBusyId(id); try { await api(`/api/sources/${id}/sync`, { method: "POST" }); } catch (err) { setError(err.message); } setBusyId(""); load(); }
  return <main className="main"><Header title="权威资料库" subtitle={`${sources.length} 个白名单来源`} actions={<button className="primary" onClick={() => setShowAdd(true)}><Plus />登记来源</button>} />
    <div className="content"><div className="source-note"><ShieldCheck /><span><strong>当前有效资料版本将在审读任务启动时固定</strong><small>来源更新后生成新版本，不覆盖历史内容</small></span></div>
      {error && <div className="error-message page-error">{error}<button onClick={() => setError("")}><X /></button></div>}
      <div className="table-shell"><table><thead><tr><th>资料来源</th><th>分类</th><th>域名</th><th>当前版本</th><th>历史版本</th><th>同步状态</th><th></th></tr></thead><tbody>{sources.map((source) => <tr key={source.id}><td><div className="source-cell"><Database /><span><strong>{source.name}</strong><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></span></div></td><td>{source.category}</td><td>{source.domain}</td><td>{source.current_version || "—"}</td><td>{source.version_count}</td><td><span className={`badge ${source.sync_status === "已同步" ? "green" : source.sync_status.startsWith("失败") ? "red" : "gray"}`}>{source.sync_status}</span></td><td><button className="icon-button outlined" onClick={() => sync(source.id)} title="立即同步" disabled={busyId === source.id}>{busyId === source.id ? <LoaderCircle className="spin" /> : <RefreshCw />}</button></td></tr>)}</tbody></table>{!sources.length && <div className="empty"><Database /><strong>暂无权威资料来源</strong><span>登记白名单来源后同步资料版本</span></div>}</div>
    </div>
    {showAdd && <div className="modal-backdrop"><div className="modal"><div className="modal-title"><div><h2>登记权威来源</h2><p>仅允许使用HTTPS官方网站或专业数据库</p></div><button className="icon-button" onClick={() => setShowAdd(false)}><X /></button></div><label className="field"><span>资料名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label className="field"><span>来源地址</span><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></label><label className="field"><span>资料分类</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>法规政策</option><option>机构与行政区划</option><option>语言文字规范</option><option>科技名词</option><option>学科知识</option></select></label><div className="modal-actions"><button className="secondary" onClick={() => setShowAdd(false)}>取消</button><button className="primary" disabled={!form.name || !form.url} onClick={add}><Plus />登记来源</button></div></div></div>}
  </main>;
}

function LoginView({ onLogin }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try { onLogin(await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, code }) })); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return <main className="login-page"><form className="login-panel" onSubmit={submit}>
    <div className="login-brand"><div className="brand-mark">鉴</div><div><strong>稿鉴</strong><span>AI书稿审读</span></div></div>
    <h1>欢迎登录稿鉴—AI审读平台</h1>
    <label className="field"><span>手机号</span><input inputMode="numeric" maxLength="11" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="请输入手机号" /></label>
    <label className="field"><span>验证码</span><span className="code-input"><input inputMode="numeric" maxLength="6" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="请输入验证码" /><button type="button" disabled={phone.length !== 11 || countdown > 0} onClick={() => setCountdown(60)}>{countdown > 0 ? `${countdown}s` : "获取验证码"}</button></span></label>
    {error && <div className="error-message">{error}</div>}
    <button className="primary login-submit" disabled={phone.length !== 11 || code.length !== 6 || busy}>{busy ? <LoaderCircle className="spin" /> : null}登录</button>
  </form></main>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [view, setView] = useState("books");
  const [bookId, setBookId] = useState(null);
  useEffect(() => { api("/api/auth/me").then(setUser).catch(() => setUser(null)); }, []);
  function openBook(id) { setBookId(id); setView("review"); }
  async function logout() { await api("/api/auth/logout", { method: "POST" }); setUser(null); setBookId(null); setView("books"); }
  if (user === undefined) return <main className="login-page"><LoaderCircle className="spin" /></main>;
  if (!user) return <LoginView onLogin={setUser} />;
  return <div className="app"><Sidebar view={view} user={user} onLogout={logout} setView={(next) => { setView(next); if (next !== "review") setBookId(null); }} />{view === "books" && <BooksView openBook={openBook} />}{view === "review" && bookId && <ReviewView bookId={bookId} back={() => setView("books")} />}{view === "sources" && <SourcesView />}</div>;
}
