/* Knight Forestry: which company this website belongs to.
   Every phone (and the Android app) connects to this link by itself, so nobody ever types or sees a link.

   Put the company script link between the quotes. It is the link you get from
   script.google.com -> Deploy -> Manage deployments (it ends in /exec).
   Until a real link is here, the app works exactly as before (the old Connect screen). */
window.KF_COMPANY_URL = 'PASTE-THE-LIVE-COMPANY-LINK-HERE';

/* More than one company on this same website? Use a list instead, and the sign-in screen asks "Which company?":
   window.KF_COMPANY_URL = [
     { name: 'Knight Forestry', url: 'https://script.google.com/macros/s/.../exec' },
     { name: 'Other company',   url: 'https://script.google.com/macros/s/.../exec' }
   ];                                                                                              */

/* TEST website only (never on the live site): shows a red TEST banner on every page. */
// window.KF_TEST = true;
