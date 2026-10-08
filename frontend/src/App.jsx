import { useEffect, useState } from 'react';
import { api } from './api';
import Editor from './Editor';

const docFromHash = () => {
  const m = window.location.hash.match(/^#\/doc\/([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
};

export default function App() {
  const [docId, setDocId] = useState(docFromHash());
  useEffect(() => {
    const onHash = () => setDocId(docFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return docId ? <Editor key={docId} docId={docId} /> : <Home />;
}

function Home() {
  const [docs, setDocs] = useState([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.listDocs().then(setDocs).catch((e) => setError(e.message)); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      const doc = await api.createDoc(title.trim() || 'Untitled');
      window.location.hash = `#/doc/${doc.id}`;
    } catch (err) { setError(err.message); }
  }

  return (
    <main className="home">
      <div className="grain" aria-hidden="true" />
      <div className="orbit orbit-one" aria-hidden="true" />
      <div className="orbit orbit-two" aria-hidden="true" />
      <header className="home-nav">
        <a className="brand" href="#/">Inkwell<span>.</span></a>
        <span className="nav-note">A shared page for real-time thoughts</span>
        <span className="nav-mark">01 / write together</span>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">No account. No fuss. Just a link.</span>
          <h1>Put your heads<br /><em>on the same page.</em></h1>
          <p className="lede">Inkwell is a tiny room for writing together. Open a page, send the link, and watch every edit land in real time.</p>
          <form onSubmit={create} className="new-doc">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name your page" aria-label="Page name" maxLength={120} />
            <button className="btn primary">Open a page <span aria-hidden="true">↗</span></button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="form-note"><span className="scribble">✳</span> Your page is private to anyone with its link.</p>
        </div>
        <div className="hero-stage" aria-label="A paper page with collaborators writing together">
          <div className="sun-disc" />
          <div className="paper-stack">
            <div className="paper-back" />
            <div className="hero-paper">
              <span className="paper-label">field notes / 09.10</span>
              <h2>Ideas are better<br /><span>when they wander.</span></h2>
              <div className="paper-rule" />
              <p>Type here. Pass it around.<br />Keep the good bits.</p>
              <span className="paper-caret" />
              <span className="sticker">made<br />together</span>
            </div>
          </div>
          <div className="doodle-arrow" aria-hidden="true">↘</div>
          <span className="stage-caption">a page in motion</span>
        </div>
      </section>
      <section className="home-lower">
        <div className="lower-intro">
          <span className="eyebrow">The good part</span>
          <h2>One page.<br /><em>Many hands.</em></h2>
        </div>
        <div className="feature-notes">
          <article className="note-card tilted-left"><span className="note-number">01</span><h3>Open the door</h3><p>Make a page with a name that means something. Or don’t. “Untitled” is a classic.</p></article>
          <article className="note-card tilted-right"><span className="note-number">02</span><h3>Send the link</h3><p>Invite a friend, a teammate, or the person who always has the best last line.</p></article>
          <article className="note-card dark-note"><span className="note-number">03</span><h3>Make a mess</h3><p>Offline edits catch up when you return. The page remembers where everyone was.</p></article>
        </div>
      </section>
      <section className="recent-section">
        <div className="section-heading"><h2>Recent pages</h2><span className="heading-line" /></div>
        {docs.length === 0 ? <p className="muted">Nothing here yet. Start a page above.</p> : (
          <ul className="doc-list">
            {docs.map((d, index) => (
              <li key={d.id}>
                <span className="list-index">0{index + 1}</span>
                <a href={`#/doc/${d.id}`}>{d.title}</a>
                <span className="muted">{new Date(d.updated_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="home-footer"><span>Inkwell / collaborative writing</span><span>Built for the in-between ideas.</span></footer>
    </main>
  );
}
