// Removed. This was a temporary diagnostic used to confirm the Neon connection
// string was valid. It is intentionally inert so no environment details are exposed.

module.exports = async (req, res) => {
  res.status(410).json({ error: 'gone' });
};
