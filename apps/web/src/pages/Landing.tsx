import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export function Landing() {
  const { user } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      tl.from(".hero [data-anim]", {
        y: 28,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.1,
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const el = featuresRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.set(".feature", { autoAlpha: 0, y: 40 });
    }, el);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            gsap.to(el.querySelectorAll(".feature"), {
              autoAlpha: 1,
              y: 0,
              duration: 0.8,
              stagger: 0.15,
              ease: "power2.out",
              overwrite: true,
            });
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      ctx.revert();
    };
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      <section className="hero">
        <p className="eyebrow" data-anim>Multi-agent research, markdown out</p>
        <h1 data-anim>Ask a topic. Get cited research back.</h1>
        <p className="sub" data-anim>
          ResearcherIt runs a team of agents — planner, writer, editor — and streams the
          result as markdown you can keep. Sign up, open the Agent, and start your first
          investigation.
        </p>
        <div className="hero-actions" data-anim>
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
      <section ref={featuresRef} className="features">
        <div className="feature">
          <h3>Agent chat</h3>
          <p>Centered composer, editable prompts, live token streaming with markdown answers and history in the sidebar.</p>
        </div>
        <div className="feature">
          <h3>History that persists</h3>
          <p>Every conversation is stored in Postgres with LLM-generated titles — pick up where you left off.</p>
        </div>
        <div className="feature">
          <h3>Cited sources</h3>
          <p>Planner searches the live web and every answer ends with its sources carded at the bottom of the chat.</p>
        </div>
      </section>
    </div>
  );
}
