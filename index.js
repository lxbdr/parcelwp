#!/usr/bin/env node

import path from "path";
import {build, watch} from "./src/build.mjs";

if (require.main === module) {

    let mode = 'development';
    const rootDir = process.cwd();
    const proxy = "http://wordpress-one.test";
    const publicUrl = "/wp-content/themes/my-theme/dist";
    const entries = ['./src/*.bundle.*'].map(entry => path.join(rootDir, entry));
    const distDir = path.join(rootDir, "/dist");
    const config = {
        wpNamespace: "theme"
    }

    const hasArg = (arg) => process.argv.slice(2).includes(arg);

    if (hasArg('build') || hasArg('production')) {
        mode = 'production';
    }

    if (mode === 'development') {
        watch(rootDir, entries, distDir, publicUrl, proxy, config);
    } else {
        build(rootDir, entries, distDir, publicUrl, config);
    }

}
