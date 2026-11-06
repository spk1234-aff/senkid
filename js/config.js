// Teacher accounts: when this list is not empty, teacher mode works ONLY on a device whose Google Drive sync is signed in
// with one of these accounts. Every other device is a student device (no switch, no PIN needed). Leave empty to allow
// any device to use teacher mode (the PIN lock in settings can still guard the switch).
const PROD_TEACHERS = ['sattrawood@sopit.ac.th'];
// local development server (the regression suite) runs without the rule unless a test opts in via localStorage
const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
let list = PROD_TEACHERS;
if (dev) { try { list = JSON.parse(localStorage.getItem('senkid.teachers') || '[]'); } catch { list = []; } }
export const TEACHER_ACCOUNTS = list;
