const fetch = require('cross-fetch');
const parseStringPromise = require('xml2js').parseStringPromise;
const core = require('@actions/core');
const fs = require('fs');
const { spawn } = require('child_process');
const process = require('process');

let version = core.getInput('minecraftVersion');

let loaderVersion = '';
let yarnVersion = '';
let minecraftVersion = '';
let fabricVersion = '';

let properties = [];

async function run() {
    if (version === "latest") {
        const yarnResp = await fetch('https://meta.fabricmc.net/v2/versions/game/', {
            method: 'get',
            credentials: 'include',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const yarnJson = await yarnResp.json();

        // eslint-disable-next-line require-atomic-updates
        version = yarnJson[0].version;
    }

    const loaderResp = await fetch('https://meta.fabricmc.net/v2/versions/loader/' + version, {
        method: 'get',
        credentials: 'include',
        mode: 'no-cors',
        headers: {
            'Content-Type': 'application/json',
        }
    });
    const yarnResp = await fetch('https://meta.fabricmc.net/v2/versions/yarn/' + version, {
        method: 'get',
        credentials: 'include',
        mode: 'no-cors',
        headers: {
            'Content-Type': 'application/json',
        }
    });

    const loaderJSON = await loaderResp.json();
    const yarnJSON = await yarnResp.json();

    core.info('[ACTION] Requesting data via HTTPS GET from https://meta.fabricmc.net/v2/versions/loader/' + version + '\n')

    yarnVersion = yarnJSON[0].version;
    minecraftVersion = yarnJSON[0].gameVersion;
    loaderVersion = loaderJSON[0].loader.version;

    core.info('[ACTION] Minecraft version retrieved! Version ' + minecraftVersion + '\n');
    core.info('[ACTION] Yarn version retrieved! Version ' + yarnVersion);
    core.info('[ACTION] Fabric Loader version retrieved! Version ' + loaderVersion + '\n');

    const mavenResp = await fetch('https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml', {
        method: 'get',
        credentials: 'include',
        mode: 'no-cors'
    });

    const text = await mavenResp.text();

    core.info('[ACTION] Requesting data via HTTPS GET from https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml')

    await parseStringPromise(text).then((result) => {
        const versions = result.metadata.versioning[0];
        let latestVersion = versions.release;

        for (const version of versions.versions[0].version) {
            if (version.endsWith(minecraftVersion)) {
                latestVersion = version;
            }
        }

        fabricVersion = latestVersion;

        core.info('[ACTION] Fabric API version retrieved! Version ' + fabricVersion);
    }).catch((err) => {
        core.setFailed(err.message);
    });

    const mod = fs.readFileSync('./src/main/resources/fabric.mod.json')
    let modJson = JSON.parse(mod);
    let writeJson = Object.assign({}, modJson);

    writeJson.depends.fabricloader = "*";
    writeJson.depends.minecraft = "*";

    fs.writeFileSync('./src/main/resources/fabric.mod.json', JSON.stringify(writeJson));

    properties.push("-Pminecraft_version=" + minecraftVersion);
    properties.push("-Pyarn_mappings=" + yarnVersion);
    properties.push("-Ploader_version=" + loaderVersion);
    properties.push("-Pfabric_version=" + fabricVersion);

    core.info('[ACTION] Running gradle build test.');

    await runBuild(() => {
        core.info('[ACTION] Running server test!');

        let dir = './run/'

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }

        fs.writeFile('./run/eula.txt', 'eula=true', { flag: 'wx' }, err => {
            if (err) {
                core.setFailed(err.message);
            }

            runServer(() => core.info('[ACTION] All tests have passed!'));
        });
    })
}

async function runBuild(callback) {
    if (!core.getInput('runBuildTest')) return;

    let build;

    if (process.platform === 'win32') {
        build = await spawn('cmd', ['/c', 'gradlew', 'build', '--refresh-dependencies'].concat(properties));
    } else {
        build = await spawn('./gradlew', ['build', '--refresh-dependencies'].concat(properties));
    }

    build.stdout.on('data', (data) => process.stdout.write(`${data}`));
    build.stderr.on('data', (data) => process.stderr.write(`${data}`));
    build.on('error', (err) => process.stderr.write(err))

    // eslint-disable-next-line no-unused-vars
    build.on('close', (code) => callback())
}

async function runServer(callback) {
    if (!core.getInput('runServerTest')) return;

    let server;

    if (process.platform === 'win32') {
        server = await spawn('gradlew', ['runServer', '--args=“nogui”'].concat(properties), { shell: true });
    } else {
        server = await spawn('./gradlew', ['runServer', '--args=“nogui”'].concat(properties));
    }

    server.stdout.on('data', (data) => {
        if (data.includes('For help, type')) {
            core.info('[ACTION] Server test complete! Exiting process.')

            if (process.platform === 'win32') {
                spawn("taskkill", ["/pid", server.pid, '/f', '/t']);
            } else {
                server.kill();
            }
        }

        process.stdout.write(`${data}`)
    });

    server.stderr.on('data', (data) => process.stderr.write(`${data}`));
    server.on('error', (err) => process.stderr.write(err))

    // eslint-disable-next-line no-unused-vars
    server.on('close', (code) => callback())
}

run();
