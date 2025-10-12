const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

function patchTsconfig() {
    // 找到项目根目录的 tsconfig.json
    let currentDir = __dirname;
    let tsconfigPath;

    // 向上查找 tsconfig.json
    for (let i = 0; i < 10; i++) {
        tsconfigPath = join(currentDir, 'tsconfig.json');
        if (existsSync(tsconfigPath)) {
            break;
        }
        tsconfigPath = join(currentDir, '../../tsconfig.json');
        if (existsSync(tsconfigPath)) {
            break;
        }
        currentDir = dirname(currentDir);
        if (currentDir === dirname(currentDir)) break; // 到达根目录
    }

    if (!existsSync(tsconfigPath)) {
        console.log('tsconfig.json not found, skipping patch');
        return;
    }

    try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));

        // 确保 compilerOptions.paths 存在
        if (!tsconfig.compilerOptions) {
            tsconfig.compilerOptions = {};
        }
        if (!tsconfig.compilerOptions.paths) {
            tsconfig.compilerOptions.paths = {};
        }

        // 添加路径映射
        const pluginName = '@shangxueink/koishi-plugin-puppeteer-without-canvas';
        const pluginPath = ['./external/puppeteer-without-canvas/src'];

        if (!tsconfig.compilerOptions.paths[pluginName]) {
            tsconfig.compilerOptions.paths[pluginName] = pluginPath;
            console.log(`Added TypeScript path mapping for ${pluginName}`);
        }

        writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
        console.log('tsconfig.json updated successfully');
    } catch (error) {
        console.log('Error patching tsconfig:', error.message);
    }
}

patchTsconfig();