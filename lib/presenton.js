// lib/presenton.js — generate a real downloadable .pptx / .pdf from the lesson.
// Docs: https://docs.presenton.ai/using-presenton-api
// Works with the hosted API (sk-presenton-... key) OR a self-hosted Docker instance.

function turnLessonIntoBrief(lesson) {
  // Flatten our structured lesson into rich text Presenton can expand into slides.
  let out = `# ${lesson.title}\n\nSubject: ${lesson.subject}\n\n`;
  for (const s of lesson.slides || []) {
    if (s.type === 'title') out += `## ${s.heading}\n${s.subtitle || ''}\n\n`;
    else if (s.type === 'flowchart') out += `## ${s.heading}\nProcess steps: ${(s.steps || []).join(' -> ')}\n\n`;
    else if (s.type === 'diagram') out += `## ${s.heading}\n${(s.parts || []).map(p => `- ${p.label}: ${p.desc}`).join('\n')}\n\n`;
    else if (s.type === 'explanation') out += `## ${s.heading}\n${(s.points || []).map(p => `- ${p.bold}: ${p.text}`).join('\n')}\n\n`;
  }
  return out;
}

export async function generateDeckFile(lesson, { format = 'pptx' } = {}) {
  const apiKey = process.env.PRESENTON_API_KEY;
  const base = process.env.PRESENTON_BASE_URL || 'https://api.presenton.ai';
  if (!apiKey || apiKey.startsWith('sk-presenton_your_')) {
    throw new Error('PRESENTON_API_KEY not set — skipping downloadable deck (the in-app deck still works).');
  }

  const res = await fetch(`${base}/api/v1/ppt/presentation/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      content: turnLessonIntoBrief(lesson),
      n_slides: (lesson.slides || []).length || 5,
      language: 'English',
      template: 'general',
      export_as: format, // 'pptx' or 'pdf'
    }),
  });
  if (!res.ok) throw new Error(`Presenton error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Presenton returns a URL/path to the generated file
  return data.path || data.presentation_url || data.url || data;
}
