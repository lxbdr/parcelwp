import path from "path";
import fs from "fs";

export default function writeEnqueueScriptsAction(rootDir, bundles, hashes = {}, mode = 'production', config) {

    config = {
        wpNamespace: "theme",
        ... config
    };

    const wpNamespace = config.wpNamespace;

    // build include file

    const enqueueScriptStr = (bundle, version = '', legacy = false) => {
        const bundleBasename = path.basename(bundle.filePath);
        const bundleRelPath = path.relative(rootDir, bundle.target.distDir)
        const versionStr = version ? `'${version}'` : 'false';
        const methodCall = legacy ? 'wp_enqueue_nomodule_script' : 'wp_enqueue_esmodule_script';
        return `${methodCall}( '${wpNamespace}/${bundleRelPath}/${bundle.name}', get_stylesheet_directory_uri() . '/${bundleRelPath}/${bundleBasename}', ['jquery'], ${versionStr} );\n`
    }

    const enqueueStyleStr = (bundle, version = '') => {
        const bundleBasename = path.basename(bundle.filePath);
        const bundleRelPath = path.relative(rootDir, bundle.target.distDir)
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

        const bundleRelPath = path.relative(rootDir, bundle.target.distDir)

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

    return output;

}
