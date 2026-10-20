/**
 * Content-script entry point. Starts the App with the features listed (and
 * switched on/off) in features/manifest.js - the single place to add, remove
 * or disable a feature. See core/app.js for the Feature contract.
 */
import { App } from './core/app.js';
import { installTrustedTypesShim } from './util/dom.js';
import { appFeatures } from './features/manifest.js';

installTrustedTypesShim();

const app = new App(appFeatures());

app.start().catch((err) => console.error('[Gemly] failed to start', err));
