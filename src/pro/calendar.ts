// The full calendar page: the base page plus the trade table, CSV, breakdown and alerts.

import "../calendar/index.ts";
import { setSettingsSections } from "../calendar/settings.ts";
import { watchHooks } from "../calendar/watch-view.ts";
import { alertsSection, initAlerts, showAlerts, watchFooter } from "./calendar/alerts-view.ts";
import { initPnlPro } from "./calendar/pnl-pro.ts";

watchHooks.footer = watchFooter;
initPnlPro();
initAlerts();
setSettingsSections(async () => alertsSection());

document.addEventListener("click", (e) => { if ((e.target as Element).id === "open-alerts") void showAlerts(); });
