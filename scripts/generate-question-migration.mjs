import { questions } from '../src/data/questions.ts';
import { writeFileSync } from 'node:fs';
const quote = (x) => "'" + String(x).replaceAll("'", "''") + "'";
const rows = questions
  .map(
    (q) =>
      `(${q.id},${quote(q.question)},${quote(JSON.stringify(q.options))}::jsonb,${q.answer},${quote(q.explanation)})`,
  )
  .join(',\n');
writeFileSync(
  'supabase/migrations/002_questions.sql',
  `-- Server-side answer key. Do not expose private schema through the API.\nbegin;\ninsert into private.questions(id,question,options,answer,explanation) values\n${rows}\non conflict(id) do update set question=excluded.question,options=excluded.options,answer=excluded.answer,explanation=excluded.explanation;\ncommit;\n`,
);
