

import {Parcel} from '@parcel/core';
import bs from 'browser-sync';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

let mode = 'development';

const proxy = "http://2be-datarespons.test";
const publicUrl = "/wp-content/themes/foundry-child/dist";
const wpNamespace = "datarespons";
const entries = ['./src/*.bundle.*'];

const hasArg = (arg) => process.argv.slice(2).includes(arg);

if (hasArg('build') || hasArg('production')) {
  mode = 'production';
}

let bundler = new Parcel({
  entries: entries,
  defaultConfig: '@parcel/config-default',
  mode: mode,
  // hmrOptions: {
  //   port: 1234
  // },
  targets: {
    default: {
      distDir: "./dist",
      engines: {
        "browsers": "last 2 Chrome versions"
      },
    },
    "legacy": {
      engines: {
        "browsers": "> 0.5%, last 2 versions, not dead"
      },
      distDir: "./dist/legacy"
    }
  },
  // shouldContentHash: mode === 'production',
  shouldAutoInstall: true,
  // serveOptions: {
  //   publicUrl: publicUrl
  // },
  defaultTargetOptions: {
    shouldOptimize: mode === 'production',
    publicUrl: publicUrl,
  }
});

if (mode === 'development') {
  watch();
} else {
  build();
}


async function build() {

  // clear dist dir

  fs.rmSync('./dist', {recursive: true, force: true});

  try {
    let {bundleGraph, buildTime} = await bundler.run();
    let bundles = bundleGraph.getBundles();
    console.log(`✨ Built ${bundles.length} bundles in ${buildTime}ms!`);

    writeEnqueueScriptsAction(bundles, getHashes(bundles));

  } catch (err) {
    console.log(err.diagnostics, err);
  }
}


// watch

async function watch() {

  // clear dist dir
  fs.rmSync('./dist', {recursive: true, force: true});

  const browser = bs.init({
    files: [
      "./dist/**/*.js",
      "./dist/**/*.css",
    ],
    proxy: {
      target: proxy,
      // ws: true // might be needed for HMR?
    },
    ghostMode: false
  })

  browser.watch(['./**/*.php',
  ], {
    ignored: ['./dist/**/*.php']
  }).on('change', browser.reload);

  return bundler.watch((err, event) => {
    if (event.type === 'buildSuccess') {
      let bundles = event.bundleGraph.getBundles();
      writeEnqueueScriptsAction(bundles, getHashes(bundles));

    } else if (event.type === 'buildFailure') {
      console.log(event.diagnostics);
    }

  });
}

function getBundleHash(bundle) {
  const hashSum = crypto.createHash('sha1');
  hashSum.update(fs.readFileSync(bundle.filePath));
  return hashSum.digest('hex');

}

function getHashes(bundles) {
  return bundles.reduce((res, bundle) => {
    const bundleRelPath = path.relative(process.cwd(), bundle.target.distDir)
    res[`${bundleRelPath}/${bundle.name}`] = getBundleHash(bundle);
    return res;
  }, {});
}

function writeEnqueueScriptsAction(bundles, hashes = {}) {
  // build include file

  const enqueueScriptStr = (bundle, version = '', legacy = false) => {
    const bundleBasename = path.basename(bundle.filePath);
    const bundleRelPath = path.relative(process.cwd(), bundle.target.distDir)
    const versionStr = version ? `'${version}'` : 'false';
    const methodCall = legacy ? 'wp_enqueue_nomodule_script' : 'wp_enqueue_esmodule_script';
    return `${methodCall}( '${wpNamespace}/${bundleRelPath}/${bundle.name}', get_stylesheet_directory_uri() . '/${bundleRelPath}/${bundleBasename}', ['jquery'], ${versionStr} );\n`
  }

  const enqueueStyleStr = (bundle, version = '') => {
    const bundleBasename = path.basename(bundle.filePath);
    const bundleRelPath = path.relative(process.cwd(), bundle.target.distDir)
    const versionStr = version ? `'${version}'` : 'false';
    return `wp_enqueue_style( '${wpNamespace}/${bundleRelPath}/${bundle.name}', get_stylesheet_directory_uri() . '/${bundleRelPath}/${bundleBasename}', [], ${versionStr} );\n`
  }

  let hasLegacy = false;
  for (let bundle of bundles) {
    if (bundle.target.name === 'legacy') {
      hasLegacy = true;
      break;
    }
  }

  const enqueueCalls = bundles.map(bundle => {

    const isLegacy = bundle.target.name === 'legacy';

    const bundleRelPath = path.relative(process.cwd(), bundle.target.distDir)

    const version = hashes?.[`${bundleRelPath}/${bundle.name}`] || "";
    if (bundle.type === "css") {
      // use modern css in dev, compatible one in production
      if (isLegacy && mode === 'development' || hasLegacy && !isLegacy && mode === 'production') {
        return "";
      }
      return enqueueStyleStr(bundle, version);
    } else if (bundle.type === "js") {
      if (isLegacy && mode === 'development') {
        // skip legacy bundles in dev mode
        return "";
      }
      return enqueueScriptStr(bundle, version, isLegacy);
    }
    return "";
  }).join('\n');

  const output = `
<?php

function wp_enqueue_esmodule_script( $handle, $src = '', $deps = array(), $ver = false, $in_footer = false ) {
    if(!isset($GLOBALS['esmodule_scripts'])) {
      $GLOBALS['esmodule_scripts'] = [];
    }

    $GLOBALS['esmodule_scripts'][] = $handle;

    wp_enqueue_script( $handle, $src, $deps, $ver, $in_footer );
}

function wp_enqueue_nomodule_script( $handle, $src = '', $deps = array(), $ver = false, $in_footer = false ) {
    if(!isset($GLOBALS['nomodule_scripts'])) {
      $GLOBALS['nomodule_scripts'] = [];
    }

    $GLOBALS['nomodule_scripts'][] = $handle;

    wp_enqueue_script( $handle, $src, $deps, $ver, $in_footer );
}

add_filter( 'script_loader_tag', function ( $tag, $handle, $src ) {

    if ( wp_get_environment_type() === 'development' ) {
        if ( in_array( $handle, $GLOBALS['esmodule_scripts'] ?? [] ) ) {
            return '';
        }

        return $tag;
    }

    if ( in_array( $handle, $GLOBALS['esmodule_scripts'] ?? [] ) ) {
        $tag = str_replace( "type='text/javascript'", "type='module'", $tag );
    } else if ( in_array( $handle, $GLOBALS['nomodule_scripts'] ?? [] ) ) {
        $tag = str_replace( '<script ', '<script nomodule ', $tag );
    }

    return $tag;
}, 10, 3 );

add_action( 'wp_enqueue_scripts', function () {

${enqueueCalls}

} );
      `;

  return new Promise((resolve, reject) => {
    fs.writeFile('dist/bundles.php', output, {
      flag: 'w+'
    }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  })


}
