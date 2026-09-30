// /api/assistant - the dashboard's chat box, backed by the real Claude API.
// The API key is read from ANTHROPIC_API_KEY server-side and never reaches the browser.
// Claude can call tools to actually create tasks/events - not just talk about them.

const { Pool } = require('pg');
let pool;
function getPool() {
  if (!pool) {
    if (!process.env.neon) throw new Error('neon env var is not set');
    pool = new Pool({ connectionString: process.env.neon, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

const MODEL = 'claude-sonnet-5';

const TOOLS = [
  {
    name: 'add_recurring_task',
    description: "Create a recurring task that shows up on the dashboard's Today list going forward, on the given cadence. Use this for anything the user wants remembered on a repeating basis (daily, or a specific weekday every week). For a task tied to a specific week of the month (e.g. 'second week of every month'), still use Weekly cadence on a representative weekday and mention the monthly timing in the task name itself, since the dashboard's recurring engine only supports Daily/Weekly natively.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short task name, e.g. "Storage room inventory check"' },
        cadence: { type: 'string', enum: ['Daily', 'Weekly'] },
        weekday: { type: 'integer', description: '0=Sunday..6=Saturday. Required if cadence is Weekly, omit for Daily.' },
      },
      required: ['name', 'cadence'],
    },
  },
  {
    name: 'add_daily_task',
    description: "Add a one-off task to today's list only (not recurring).",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'add_event',
    description: 'Add a new event to the event pipeline (e.g. a wellness event, workshop, or challenge). This seeds the 8-step (or 9-step, if it needs a vendor) event pipeline on the given date.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        pillar: { type: 'string', enum: ['Mindset', 'Nutrition', 'Movement', 'Recovery'] },
        needsVendor: { type: 'boolean', description: 'True if this event needs a vendor or service with no existing SOP, which routes through Michelle first.' },
      },
      required: ['name', 'date'],
    },
  },
];

async function runTool(name, input) {
  const db = getPool();
  if (name === 'add_recurring_task') {
    const id = 'rc-x' + Date.now();
    await db.query(
      `insert into recur_tasks (id, name, cadence, weekday, source) values ($1,$2,$3,$4,'custom')`,
      [id, input.name, input.cadence, input.cadence === 'Weekly' ? (input.weekday ?? null) : null]
    );
    return { ok: true, id };
  }
  if (name === 'add_daily_task') {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.query(
      `insert into daily_tasks (day_key, name) values ($1,$2) returning id`,
      [today, input.name]
    );
    return { ok: true, id: r.rows[0].id };
  }
  if (name === 'add_event') {
    const r = await db.query(
      `insert into events (name, event_date, pillar) values ($1,$2,$3) returning id`,
      [input.name, input.date, input.pillar || null]
    );
    return { ok: true, id: r.rows[0].id, needsVendor: !!input.needsVendor };
  }
  return { ok: false, error: 'unknown tool' };
}

function buildSystem(ctx = {}) {
  const today = ctx.today || '(unknown)';
  const tasks = (ctx.tasks || [])
    .map(t => `- ${t.name} [${t.cad}${t.done ? ', done' : t.status === 'over' ? ', OVERDUE' : ''}]`)
    .join('\n') || '(none)';
  const events = (ctx.events || []).map(e => {
    const steps = (e.steps || []).map(s => `${s.k}: ${s.st}`).join('; ');
    return `- ${e.name} on ${e.date}${e.pillar ? ` (${e.pillar})` : ''}, ${e.daysOut} days out${e.compressed ? ' - COMPRESSED TIMELINE' : ''}${steps ? `\n    steps: ${steps}` : ''}`;
  }).join('\n') || '(none)';
  const links = (ctx.links || [])
    .map(l => `- ${l.title} [${l.category}]: ${l.url}`)
    .join('\n') || '(none)';

  return `You are the on-site assistant embedded in William Farparan's coach dashboard. He is a Certified Performance Coach employed by Exos, working on-site at Adobe's San Francisco wellness centers (Hooper and 601 Townsend).

TODAY: ${today}

WHAT IS ON HIS DASHBOARD RIGHT NOW
Tasks:
${tasks}

Events in the pipeline:
${events}

LINKS ON HIS DASHBOARD (trackers, forms, SOPs)
${links}
When he asks where something is or to open a tracker, form, or policy, answer with the matching link as a markdown link, e.g. [Incident Report](url). Never invent a URL that is not in this list.

YOU CAN TAKE REAL ACTION
You have tools to create a recurring task, a one-off task for today, or a new event. When the user asks you to remember something, add a task, or set a reminder - ANY phrasing, not just "remind me to X every Y" - actually call the appropriate tool. Do not just describe what you would add; add it. After calling a tool, confirm briefly what you created. If a detail is ambiguous (e.g. which weekday, or "second week of the month"), make a reasonable choice, create it, and say what you chose rather than asking first - he can always ask you to change it.

WHO HE WORKS WITH
- Michelle Bariao (exo30631) - Account Manager. All escalations and anything without an existing SOP.
- Sahar Rasheed (cbr82716) - Site Operations, room and space booking.
- Joshua Dougherty (bon02117) - Culinary, catering requests.
- Coaches: Antoine Robinson (exo08583), Christopher Pham (exo78564), William (exo46532).
- Kelly - newsletter review. Drafts due the 15th, final by the 20th, sends the 1st.

HARD RULES
- If an event needs a vendor, service, or event type with NO existing SOP, he must loop in Michelle FIRST, before contacting anyone else. Non-negotiable - say so plainly when it applies.
- Compressed timeline: if an event is under two weeks out, venue booking, flyer, and the initial Slack post run IN PARALLEL, not in sequence.
- Post-event survey goes out within 3 days via Microsoft Forms, NPS is always question 1, follow up if response rate is under 20% by day 7, always BCC attendees.
- Attendance is tracked with the badge reader into the Tabling Event Tracker, a new tab per event.

EVENT PIPELINE (normal spacing, days before the event)
Pin down date (~35), book room with Sahar (~28), flyer or poster (~21), catering with Josh (~21), initial Slack post (~18), secondary Slack post (~10), third Slack post (~3), day-of post.

RECURRING CADENCE
Daily on weekdays: reset weight room AM and PM, check three inboxes (Exos Gmail, Adobe, Wellness), log Workday hours.
Weekly: workout on the board Monday, Strength Lab programming Wednesday to Friday, White Glove Walkthrough Thursday or Friday, Exos team meeting Friday.
Monthly: FDT badge report in the last week, newsletter draft to Kelly by the 15th, class schedule updates.
Quarterly: Member of the Month.

BRAND VOICE
- The company is "Exos" in title case. Never all caps, never lowercase.
- Write like you speak: direct, confident, a little wry. No corporate filler.
- Sentence case in body copy. The one exception is a Slack post headline, which is all caps with an emoji anchor.
- Slack post shape: all-caps emoji headline, then a 2-3 sentence opener, then an emoji-anchored detail block, then a clear call to action, then a community closer, then the sign-off "Your Wellness Team," followed by @exo78564 @exo08583 @exo46532.
- Exos colors: teal #00A99D, navy #1B3A5C, aquamarine #6ECFCC. Adobe red #FA0F00.
- The Four Pillars - Mindset, Nutrition, Movement, Recovery - anchor how programs are framed.

HOW TO ANSWER
- Be concise and specific. He is usually reading this on a narrow side panel between clients.
- When he asks what to do, use the actual dashboard state above. Name the real task or step, not a generic answer.
- When he asks for a Slack post, newsletter section, or an email to Sahar, Josh, or Michelle, write the finished draft ready to paste. No preamble.
- If something is blocked or overdue, say so directly rather than burying it.
- If you do not know a detail such as a price, a headcount, or a room, ask for that one thing rather than inventing it.`;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(200).json({
      text: "I'm not connected to Claude yet - the ANTHROPIC_API_KEY environment variable isn't set on this deployment. Add it in Vercel under Settings, Environment Variables, then redeploy. In the meantime I can still add and track tasks."
    });
  }

  try {
    const { messages = [], context = {} } = req.body || {};
    const trimmed = messages.slice(-12).filter(m => m && m.content);
    if (!trimmed.length) return res.status(400).json({ error: 'no messages' });

    let convo = trimmed.map(m => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: String(m.content),
    }));

    let changed = false;
    let finalText = '';
    const system = buildSystem(context);

    // Tool-use loop: Claude may call a tool, we run it, feed the result back,
    // and let it continue - up to a few rounds so it can't loop forever.
    for (let round = 0; round < 4; round++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1200,
          system,
          tools: TOOLS,
          messages: convo,
        }),
      });

      const data = await r.json();
      if (!r.ok) {
        const detail = (data && data.error && data.error.message) || 'unknown error';
        return res.status(200).json({ text: `Claude returned an error: ${detail}`, changed });
      }

      const textParts = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (textParts) finalText = textParts;

      const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
      if (!toolUses.length) break;

      convo.push({ role: 'assistant', content: data.content });

      const toolResults = [];
      for (const call of toolUses) {
        let result;
        try {
          result = await runTool(call.name, call.input || {});
          if (result.ok) changed = true;
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
        });
      }
      convo.push({ role: 'user', content: toolResults });

      if (data.stop_reason !== 'tool_use') break;
    }

    return res.status(200).json({ text: finalText || '(empty response)', changed });
  } catch (err) {
    return res.status(200).json({ text: `Couldn't reach Claude: ${err.message}` });
  }
};
