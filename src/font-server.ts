import { createServer, Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { Context } from 'koishi'

export class FontServer {
    private server: Server | null = null
    private port: number | null = null
    private fontPath: string | null = null
    private ctx: Context

    constructor(ctx: Context) {
        this.ctx = ctx
    }

    /**
     * 启动字体服务器
     * @param fontPath 字体文件路径
     * @returns 字体文件的本地 HTTP URL
     */
    async start(fontPath: string): Promise<string> {
        // 如果已经启动且路径相同，直接返回现有 URL
        if (this.server && this.fontPath === fontPath && this.port) {
            return this.getFontUrl()
        }

        // 停止现有服务器
        await this.stop()

        this.fontPath = fontPath

        try {
            // 检查字体文件是否存在
            const stats = await stat(fontPath)
            if (!stats.isFile()) {
                throw new Error(`指定的路径不是文件: ${fontPath}`)
            }

            // 检查文件扩展名
            const ext = extname(fontPath).toLowerCase()
            const supportedExts = ['.ttf', '.otf', '.woff', '.woff2', '.ttc']
            if (!supportedExts.includes(ext)) {
                throw new Error(`不支持的字体文件格式: ${ext}，支持的格式: ${supportedExts.join(', ')}`)
            }

            // 创建 HTTP 服务器
            this.server = createServer(async (req, res) => {
                try {
                    // 设置 CORS 头
                    res.setHeader('Access-Control-Allow-Origin', '*')
                    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

                    if (req.method === 'OPTIONS') {
                        res.writeHead(200)
                        res.end()
                        return
                    }

                    if (req.method !== 'GET') {
                        res.writeHead(405, { 'Content-Type': 'text/plain' })
                        res.end('Method Not Allowed')
                        return
                    }

                    // 只处理字体文件请求
                    const url = new URL(req.url!, `http://localhost:${this.port}`)
                    const pathname = url.pathname

                    if (pathname === '/font' || pathname === `/${basename(fontPath)}`) {
                        // 读取字体文件
                        const fontData = await readFile(fontPath)

                        // 设置正确的 Content-Type
                        const mimeType = this.getMimeType(ext)
                        res.setHeader('Content-Type', mimeType)
                        res.setHeader('Content-Length', fontData.length)
                        res.setHeader('Cache-Control', 'public, max-age=31536000') // 缓存一年

                        res.writeHead(200)
                        res.end(fontData)
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' })
                        res.end('Font Not Found')
                    }
                } catch (error) {
                    this.ctx.logger.error('字体服务器处理请求时出错:', error)
                    res.writeHead(500, { 'Content-Type': 'text/plain' })
                    res.end('Internal Server Error')
                }
            })

            // 监听随机端口
            this.port = await this.getAvailablePort()

            return new Promise((resolve, reject) => {
                this.server!.listen(this.port, 'localhost', () => {
                    this.ctx.logger.info('字体服务器已启动: %c', `http://localhost:${this.port}/font`)
                    resolve(this.getFontUrl())
                })

                this.server!.on('error', (error) => {
                    this.ctx.logger.error('字体服务器启动失败:', error)
                    reject(error)
                })
            })

        } catch (error) {
            this.ctx.logger.error('启动字体服务器失败:', error)
            throw error
        }
    }

    /**
     * 停止字体服务器
     */
    async stop(): Promise<void> {
        if (this.server) {
            return new Promise((resolve) => {
                this.server!.close(() => {
                    this.server = null
                    this.port = null
                    this.fontPath = null
                    resolve()
                })
            })
        }
    }

    /**
     * 获取字体文件的本地 URL
     */
    getFontUrl(): string {
        if (!this.port) {
            throw new Error('字体服务器未启动')
        }
        return `http://localhost:${this.port}/font`
    }

    /**
     * 检查服务器是否正在运行
     */
    isRunning(): boolean {
        return this.server !== null && this.port !== null
    }

    /**
     * 获取可用端口
     */
    private async getAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = createServer()
            server.listen(0, 'localhost', () => {
                const port = (server.address() as any)?.port
                server.close(() => {
                    if (port) {
                        resolve(port)
                    } else {
                        reject(new Error('无法获取可用端口'))
                    }
                })
            })
            server.on('error', reject)
        })
    }

    /**
     * 根据文件扩展名获取 MIME 类型
     */
    private getMimeType(ext: string): string {
        const mimeTypes: Record<string, string> = {
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttc': 'font/ttf', // TrueType Collection
        }
        return mimeTypes[ext] || 'application/octet-stream'
    }
}