// @ts-check
/**
 * @file Progressive enhancement entry point: starts every client feature.
 */
/**
 * Progressive enhancement entry point. Every feature checks for its own
 * elements and does nothing if they are missing; the site works without JS.
 */
import { initCardProgress, initChecklist, initGuideNav, initToc } from './checklist.mjs';
import { initClearData } from './clear-data.mjs';
import { initContinue } from './continue.mjs';
import { initFilters } from './filters.mjs';
import { initPrint } from './print.mjs';
import { initSearch } from './search.mjs';
import { startFeatures } from './start.mjs';
import { initTabs } from './tabs.mjs';
import { initTheme } from './theme.mjs';
import { initTools } from './tools.mjs';

startFeatures(
  [
    { name: 'theme', init: initTheme },
    { name: 'tabs', init: initTabs, layout: true },
    { name: 'contents list', init: initToc, layout: true },
    { name: 'guide sidebar', init: initGuideNav },
    { name: 'checklist', init: initChecklist },
    { name: 'filters', init: initFilters },
    { name: 'card progress', init: initCardProgress },
    { name: 'continue', init: initContinue },
    { name: 'print', init: initPrint },
    { name: 'search', init: initSearch },
    { name: 'tools', init: initTools },
    { name: 'clear data', init: initClearData },
  ],
  document.documentElement,
);
