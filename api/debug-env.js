// /api/debug-env — TEMPORARY diagnostic. Reports whether env vars are present
// and structurally parseable, WITHOUT ever exposing their values. Delete after use.

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const out = {};

  const neon = process.env.neon;
  out.neon_present = !!neon;
  out.neon_length = neon ? neon.length : 0;
  if (neon) {
    try {
      const u = new URL(neon);
      out.neon_protocol = u.protocol;
      out.neon_host = u.hostname;          // safe: host is not secret, password is
      out.neon_port = u.port || '(default)';
      out.neon_pathname = u.pathname;
      out.neon_search = u.search;
    } catch (err) {
      out.neon_parse_error = err.message;
    }
  }

  out.google_client_id_present = !!process.env.GOOGLE_CLIENT_ID;
  out.google_client_secret_present = !!process.env.GOOGLE_CLIENT_SECRET;

  res.status(200).json(out);
};
