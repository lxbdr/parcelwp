import {Parcel} from '@parcel/core';
import bs from 'browser-sync';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import writeEnqueueScriptsAction from "./writeEnqueueScriptsAction.mjs";


const getBundleHash = (bundle) => {
    const hashSum = crypto.createHash('sha1');
    hashSum.update(fs.readFileSync(bundle.filePath));
    return hashSum.digest('hex');

}

const getHashes = (rootDir, bundles) => {
    return bundles.reduce((res, bundle) => {
        const bundleRelPath = path.relative(rootDir, bundle.target.distDir)
        res[`${bundleRelPath}/${bundle.name}`] = getBundleHash(bundle);
        return res;
    }, {});
}

const getParcel = (mode, rootDir, entries, distDir, publicUrl) => {
    return new Parcel({
        entries: entries,
        defaultConfig: '@parcel/config-default',
        mode: mode,
        // hmrOptions: {
        //   port: 1234
        // },
        targets: {
            default: {
                distDir: distDir,
                engines: {
                    "browsers": "last 2 Chrome versions"
                },
            },
            "legacy": {
                engines: {
                    "browsers": "> 0.5%, last 2 versions, not dead"
                },
                distDir: path.join(distDir, '/legacy')
            }
        },
        shouldContentHash: mode === 'production',
        shouldAutoInstall: true,
        // serveOptions: {
        //   publicUrl: publicUrl
        // },
        defaultTargetOptions: {
            shouldOptimize: mode === 'production',
            publicUrl: publicUrl,
        }
    });
}


export const build = async (rootDir, entries, distDir, publicUrl, config = {}) => {

    config = {
        wpNamespace: "theme",
        ...config
    }

    const mode = 'production';
    const wpNamespace = config.wpNamespace;

    const bundler = getParcel(mode, rootDir, entries, distDir, publicUrl);

    // clear dist dir

    fs.rmSync(distDir, {recursive: true, force: true});

    try {
        let {bundleGraph, buildTime} = await bundler.run();
        let bundles = bundleGraph.getBundles();
        console.log(`✨ Built ${bundles.length} bundles in ${buildTime}ms!`);

        const code = writeEnqueueScriptsAction(rootDir, bundles, getHashes(rootDir, bundles), mode, {
            wpNamespace
        });

        return new Promise((resolve, reject) => {
            const outputFile = path.join(distDir, '/bundles.php');
            fs.writeFile(outputFile, code, {
                flag: 'w+'
            }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(outputFile);
                }
            });
        })


    } catch (err) {
        console.log(err.diagnostics, err);
    }
};

export const watch = async (rootDir, entries, distDir, publicUrl, proxy, config = {}) => {
    config = {
        wpNamespace: "theme",
        ...config
    }

    const mode = 'development';
    const wpNamespace = config.wpNamespace;


    const bundler = getParcel(mode, rootDir, entries, distDir, publicUrl);

    // clear dist dir
    fs.rmSync(distDir, {recursive: true, force: true});

    const browser = bs.init({
        files: [
            path.join(distDir, '**/*.js'),
            path.join(distDir, '**/*.css')
        ],
        proxy: {
            target: proxy,
            // ws: true // might be needed for HMR?
        },
        ghostMode: false
    })

    browser.watch([path.join(rootDir, '**/*.php'),
    ], {
        ignored: [path.join(distDir, '**/*.php')]
    }).on('change', browser.reload);

    return bundler.watch((err, event) => {
        if (event.type === 'buildSuccess') {
            let bundles = event.bundleGraph.getBundles();
            const code = writeEnqueueScriptsAction(rootDir, bundles, getHashes(rootDir, bundles), mode, {
                wpNamespace
            });

            new Promise((resolve, reject) => {
                fs.writeFile(path.join(distDir, '/bundles.php'), code, {
                    flag: 'w+'
                }, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            })

        } else if (event.type === 'buildFailure') {
            console.log(event.diagnostics);
        }

    });
};

