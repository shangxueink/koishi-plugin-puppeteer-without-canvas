module.exports = {
    name: 'yarn-plugin-tsconfig',
    factory: (require) => {
        const { readFileSync, writeFileSync, existsSync } = require('fs')
        const { join } = require('path')

        return {
            hooks: {
                afterAllInstalled: async (project) => {
                    await updateTsconfig(project)
                }
            }
        }

        async function updateTsconfig(project) {
            const tsconfigPath = join(project.cwd, 'tsconfig.json')

            if (!existsSync(tsconfigPath)) {
                console.log('tsconfig.json not found, skipping auto-configuration')
                return
            }

            try {
                const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))

                // 确保 compilerOptions.paths 存在
                if (!tsconfig.compilerOptions) {
                    tsconfig.compilerOptions = {}
                }
                if (!tsconfig.compilerOptions.paths) {
                    tsconfig.compilerOptions.paths = {}
                }

                // 自动检测 external 目录中的插件并添加路径映射
                const fs = require('fs')
                const externalPath = join(project.cwd, 'external')

                if (existsSync(externalPath)) {
                    const plugins = fs.readdirSync(externalPath)

                    for (const pluginDir of plugins) {
                        const pluginPkgPath = join(externalPath, pluginDir, 'package.json')

                        if (existsSync(pluginPkgPath)) {
                            try {
                                const pkg = JSON.parse(readFileSync(pluginPkgPath, 'utf8'))
                                const pluginName = pkg.name
                                const srcPath = `./external/${pluginDir}/src`

                                // 检查 src 目录是否存在
                                if (existsSync(join(externalPath, pluginDir, 'src'))) {
                                    if (!tsconfig.compilerOptions.paths[pluginName]) {
                                        tsconfig.compilerOptions.paths[pluginName] = [srcPath]
                                        console.log(`✓ Added TypeScript path for: ${pluginName}`)
                                    }
                                }
                            } catch (e) {
                                // 忽略无效的 package.json
                            }
                        }
                    }
                }

                writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))
                console.log('✓ tsconfig.json updated automatically')

            } catch (error) {
                console.log('✗ Error updating tsconfig:', error.message)
            }
        }
    }
}
