import fetch from 'node-fetch';

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

let cachedToken = null;
let tokenExpiry = 0;

// Получаем access_token через OAuth
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 10000) return cachedToken;

  const clientId = process.env.GIGACHAT_CLIENT_ID;
  const clientSecret = process.env.GIGACHAT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Client ID or Secret not set');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'scope=GIGACHAT_API_PERS'
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token');

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 1800) * 1000; // expires_in в секундах
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { thoughts } = req.body;
  if (!thoughts || !Array.isArray(thoughts) || thoughts.length === 0) {
    return res.status(400).json({ error: 'No thoughts provided' });
  }

  try {
    const token = await getAccessToken();

    const systemPrompt = `
Ты — квалифицированный психолог-аналитик. Тебе предоставлены короткие мысли человека, записанные в случайные моменты дня. Эти записи отражают текущие ощущения, размышления и наблюдения автора о себе и своём поведении.

Твоя задача — провести холодный аналитический разбор этих мыслей:
- выявить повторяющиеся темы или паттерны;
- заметить явные зацикленности или ригидные мысли;
- описать ключевые эмоциональные и когнитивные тенденции, присутствующие в текстах;
- учитывать, что тексты ситуативные, быстрые, не структурированные, могут быть фрагментарными.

Важно:
- не давать советы и не предлагать действия;
- не делать интерпретаций, связанных с личностью автора;
- не использовать эмоциональные оценки типа “хорошо/плохо”;
- фокусироваться на фактах из текста, паттернах и наблюдаемых тенденциях.

Дай результат в виде чёткого структурного анализа мыслей, перечисляя выявленные темы, повторения, зацикленности и особенности мышления.
`;

    const chatRes = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'GigaChat-2-Pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: thoughts.join('\n') }
        ],
        n: 1
      })
    });

    const data = await chatRes.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      return res.status(500).json({ error: 'Empty response from GigaChat' });
    }

    res.status(200).json({ analysis: data.choices[0].message.content });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get analysis', details: err.message });
  }
}

