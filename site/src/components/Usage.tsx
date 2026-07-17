import CodeBlock from './CodeBlock';

const examples = [
  {
    title: 'Basic download',
    code: 'avpull "https://youtu.be/VIDEO_ID"',
    desc: 'Downloads and converts to mp3 by default (192 kbps).',
  },
  {
    title: 'Custom format and quality',
    code: 'avpull "https://youtu.be/VIDEO_ID" -f mp4 -q 1080',
    desc: 'Download video in mp4 format at 1080p resolution.',
  },
  {
    title: 'Batch download',
    code: `avpull -b urls.txt

# urls.txt
https://youtu.be/VIDEO_1
https://youtu.be/VIDEO_2`,
    desc: 'Process multiple URLs from a text file.',
  },
  {
    title: 'Custom output and filename',
    code: 'avpull "https://youtu.be/VIDEO_ID" -o ./downloads -n "my-song" -f wav -q 320',
    desc: 'Save to a specific directory with a custom filename.',
  },
  {
    title: 'All options',
    code: 'avpull --help',
    desc: 'Display all available flags and options.',
  },
];

export default function Usage() {
  return (
    <section id="usage">
      <h2>usage</h2>
      {examples.map((ex) => (
        <div className="usage-group" key={ex.title}>
          <h3>{ex.title}</h3>
          <CodeBlock code={ex.code} id={`usage-${ex.title.replace(/\s/g, '-').toLowerCase()}`} />
          <p className="desc">{ex.desc}</p>
        </div>
      ))}
    </section>
  );
}
