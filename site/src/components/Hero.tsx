export default function Hero() {
  return (
    <header>
      <h1>avpull</h1>
      <p className="tagline">
        Download audio/video from YouTube, convert directly to your chosen format — mp3, wav, mp4,
        and more. No sketchy third-party sites.
      </p>
      <div className="hero-actions">
        <a href="#install" className="btn btn-primary">Install</a>
        <a href="#usage" className="btn btn-secondary">Read docs</a>
      </div>
      <div className="hero-example">
        <code>avpull &quot;https://youtu.be/dQw4w9WgXcQ&quot; -f mp3 -q 320</code>
      </div>
    </header>
  );
}
