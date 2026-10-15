import { useState } from "react";
import { ArrowLeft, ChevronRight, Folder, Keyboard, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { CardIcon } from "@/components/ingest/IngestView";
import { HomeView } from "./HomeView";
import { ResumeLatestSession } from "./RecentSessions";
import "./welcome-demo.css";

/** Review-only welcome concept. Enabled by ?welcome-demo in development. */
export function WelcomeDemo({ dropping }: { dropping: boolean }) {
  const [history, setHistory] = useState(false);
  const error = useStore((s) => s.openError);
  const recents = useStore((s) => s.recents);
  const openFolder = async () => {
    const path = await api.pickFolder("Choose a folder of photos to cull");
    if (path) void useStore.getState().openFolder(path);
  };
  if (history) return <div className="welcome-history"><button className="welcome-back" onClick={() => setHistory(false)}><ArrowLeft size={16} /> Back to welcome</button><HomeView dropping={dropping} /></div>;
  return <main className="welcome-demo">
    <div className="welcome-photo"><img src="/welcome-mountains.png" alt="Mountain ridges emerging through layers of mist" /></div>
    <section className="welcome-panel" aria-label="Welcome to OpenCull">
      <div className="welcome-center">
        <h1>OpenCull</h1>
        <p className="welcome-message">Welcome back!<br />Continue where you left off or start a new session.</p>
        <div className="welcome-actions">
          <div className="welcome-resume"><ResumeLatestSession className="welcome-primary" /></div>
          <div className="welcome-folder-row">
            <button className="welcome-folder" onClick={() => void openFolder()}><Folder size={19} />Open Folder</button>
            <button className="welcome-settings" aria-label="Settings" title="Settings" onClick={() => useStore.getState().set("settingsOpen", true)}><Settings size={19} /></button>
          </div>
          <button className="welcome-ingest" onClick={() => useStore.setState({ ingestOpen: true, ingestFrom: null })}><CardIcon className="size-[18px]" />Ingest from Card</button>
        </div>
        <button className="welcome-recent" onClick={() => setHistory(true)}>Recent folders &amp; sessions<ChevronRight size={15} /></button>
        {error && <p role="alert" className="welcome-error">{error}</p>}
      </div>
      <footer className="welcome-foot"><div><p>Your photographs. Your choices.</p><p>{recents.length ? `${recents.length} recent folder${recents.length === 1 ? "" : "s"}` : "Ready for your next shoot"} · Everything stays on your device.</p></div><button aria-label="Keyboard Shortcuts" title="Keyboard Shortcuts" onClick={() => useStore.getState().set("shortcutsOpen", true)}><Keyboard size={18} /></button></footer>
    </section>
    {dropping && <div className="welcome-drop">Drop a folder to open it</div>}
  </main>;
}
