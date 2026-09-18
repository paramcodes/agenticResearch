import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Multi-agent research, markdown out</p>
        <h1>Ask a topic. Get cited research back.</h1>
        <p className="sub">
          ResearcherIt runs a team of agents — planner, searchers, synthesizer — and streams the
          result as markdown you can keep. Sign up, open the Agent, and start your first
          investigation.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link to="/agent" className="btn btn-primary">
              Open the Agent
            </Link>
          ) : (
            <>
              <Link to="/signup" className="btn btn-primary">
                Get started
              </Link>
              <Link to="/login" className="btn btn-ghost">
                Login
              </Link>
            </>
          )}
        </div>
      </section>
      <section className="features">
        <div className="feature">
          <h3>Agent chat</h3>
          <p>Centered composer, editable prompts, markdown answers with history in the sidebar.</p>
        </div>
        <div className="feature">
          <h3>History that persists</h3>
          <p>Every conversation is stored in Postgres — pick up where you left off.</p>
        </div>
        <div className="feature">
          <h3>Streaming soon</h3>
          <p>Websocket endpoint is live today; token streaming lands with the real graph.</p>
        </div>
      </section>
    </div>
  );
}
