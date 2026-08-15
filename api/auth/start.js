// /api/auth/start — redirects the browser into Google's OAuth consent flow.
// Reads GOOGLE_CLIENT_ID from env. No secrets touch the client.

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.status(500).send('GOOGLE_CLIENT_ID is not set in this deployment.');
          }

            const proto = req.headers['x-forwarded-proto'] || 'https';
              const host = req.headers['x-forwarded-host'] || req.headers.host;
                const redirectUri = `${proto}://${host}/api/auth/callback`;

                  const params = new URLSearchParams({
                      client_id: clientId,
                          redirect_uri: redirectUri,
                              response_type: 'code',
                                  access_type: 'offline',
                                      prompt: 'consent',
                                          scope: 'https://www.googleapis.com/auth/calendar.readonly',
                                            });

                                              res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
                                                res.end();
                                                };
                                                
