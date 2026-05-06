export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ backendUrl: process.env.BACKEND_URL || null });
}
