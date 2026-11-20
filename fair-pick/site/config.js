// Where the page finds its API, the Worker in ../api, as an https:// URL
// without a trailing slash. pages.yml writes the repository variable
// FAIR_PICK_API here when it builds the site, and `npm run serve` its own
// address; while it is empty the page says the server is not connected.
export const API_BASE = '';
