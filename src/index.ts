import puppeteer, { Browser, ConnectOptions, ElementHandle, Page } from 'puppeteer-core'
import find from 'puppeteer-finder'
import { } from '@cordisjs/plugin-proxy-agent'
import { Context, h, hyphenate, Schema, Service } from 'koishi'
import { SVG, SVGOptions } from './svg'
import Canvas from './canvas'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

export * from './svg'

declare module 'koishi' {
  interface Context {
    puppeteer: Puppeteer
  }
}

type RenderCallback = (page: Page, next: (handle?: ElementHandle) => Promise<string>) => Promise<string>

class Puppeteer extends Service {
  static [Service.provide] = 'puppeteer'
  static inject = ['http']

  browser: Browser
  executable: string

  constructor(ctx: Context, public config: Puppeteer.Config) {
    super(ctx, 'puppeteer')
    if (this.config.enableCanvas !== false) {
      ctx.plugin(Canvas)
    }
  }
  async start() {
    const { remote, endpoint, executablePath, headers, headless, args = [], ...config } = this.config

    try {
      if (remote) {
        if (!endpoint) {
          throw new Error('远程浏览器模式下必须提供 endpoint 参数')
        }

        const connectOptions: ConnectOptions = { headers, ...config }

        try {
          const endpointURL = new URL(endpoint)

          if (['ws:', 'wss:'].includes(endpointURL.protocol)) {
            // 不再检查路径格式，接受任何有效的 WebSocket URL
            connectOptions.browserWSEndpoint = endpoint
          } else if (['http:', 'https:'].includes(endpointURL.protocol)) {
            connectOptions.browserURL = endpoint
          } else {
            throw new Error(`不支持的协议: ${endpointURL.protocol}，endpoint 必须以 ws://, wss://, http:// 或 https:// 开头`)
          }
        } catch (e) {
          if (e instanceof TypeError) {
            throw new Error(`无效的 endpoint URL: ${endpoint}，请检查格式是否正确`)
          }
          throw e
        }

        try {
          this.ctx.logger.info('正在连接远程浏览器: %c', endpoint)
          this.browser = await puppeteer.connect(connectOptions)
          this.ctx.logger.info('远程浏览器连接成功。')
        } catch (e) {
          // 处理连接错误
          if (e.message?.includes('ECONNREFUSED')) {
            throw new Error(`无法连接到远程浏览器 ${endpoint}，请确保远程浏览器已启动并且端口可访问`)
          } else if (e.message?.includes('not opened')) {
            throw new Error(`远程浏览器连接被拒绝，请确保提供的 endpoint 是正确的并且浏览器已启动调试模式`)
          } else {
            // 确保包含原始错误信息
            throw new Error(`连接远程浏览器失败: ${e.message || e}`)
          }
        }
      } else {
        // 查找可执行文件路径
        this.executable = executablePath || find()
        if (!this.executable) {
          throw new Error('未找到 Chrome 可执行文件，请手动指定 executablePath 参数')
        }

        if (!executablePath) {
          this.ctx.logger.info('找到 Chrome 可执行文件: %c', this.executable)
        }

        // 处理代理设置
        const localArgs = [...args]
        const { proxyAgent } = this.ctx.http.config
        if (proxyAgent && !localArgs.some(arg => arg.startsWith('--proxy-server'))) {
          localArgs.push(`--proxy-server=${proxyAgent}`)
        }

        try {
          // 启动浏览器
          this.ctx.logger.info('正在启动本地浏览器...')
          this.browser = await puppeteer.launch({
            executablePath: this.executable,
            headless,
            args: localArgs,
            ...config
          })
          this.ctx.logger.info('本地浏览器启动成功。')
        } catch (e) {
          if (e.message?.includes('Failed to launch')) {
            throw new Error(`启动浏览器失败，请检查 Chrome 是否已安装或路径是否正确: ${e.message}`)
          } else {
            throw new Error(`启动浏览器失败: ${e.message || e}`)
          }
        }
      }
    } catch (error) {
      this.ctx.logger.error(`Puppeteer 初始化失败: `, error)
      throw error
    }
    const transformStyle = (source: {}, base = {}) => {
      return Object.entries({ ...base, ...source }).map(([key, value]) => {
        return `${hyphenate(key)}: ${Array.isArray(value) ? value.join(', ') : value}`
      }).join('; ')
    }

    this.ctx.component('html', async (attrs, children) => {
      const head: h[] = []

      const transform = (element: h) => {
        if (element.type === 'head') {
          head.push(...element.children)
          return
        }
        const attrs = { ...element.attrs }
        if (typeof attrs.style === 'object') {
          attrs.style = transformStyle(attrs.style)
        }
        return h(element.type, attrs, element.children.map(transform).filter(Boolean))
      }

      const page = await this.page()
      try {
        if (attrs.src) {
          await page.goto(attrs.src)
        } else {
          await page.goto(pathToFileURL(resolve(__dirname, '../index.html')).href)
          const bodyStyle = typeof attrs.style === 'object'
            ? transformStyle({ display: 'inline-block' }, attrs.style)
            : ['display: inline-block', attrs.style].filter(Boolean).join('; ')
          const content = children.map(transform).filter(Boolean).join('')
          const lang = attrs.lang ? ` lang="${attrs.lang}"` : ''
          await page.setContent(`<html${lang}>
            <head>${head.join('')}</head>
            <body style="${bodyStyle}">${content}</body>
          </html>`)
        }
        await page.waitForNetworkIdle({
          timeout: attrs.timeout ? +attrs.timeout : undefined,
        })
        const body = await page.$(attrs.selector || 'body')
        const clip = await body.boundingBox()
        const screenshot = await page.screenshot({ clip }) as Buffer
        return h.image(screenshot, 'image/png')
      } finally {
        await page?.close()
      }
    })
  }

  async stop() {
    if (this.config.remote) {
      await this.browser?.disconnect()
    } else {
      await this.browser?.close()
    }
  }

  page = () => this.browser.newPage()

  svg = (options?: SVGOptions) => new SVG(options)

  render = async (content: string, callback?: RenderCallback) => {
    const page = await this.page()
    await page.goto(pathToFileURL(resolve(__dirname, '../index.html')).href)
    if (content) await page.setContent(content)
    const renderConfig = this.config.render || {}

    callback ||= async (_, next) => page.$('body').then(next)
    const output = await callback(page, async (handle) => {
      const clip = handle ? await handle.boundingBox() : null
      const screenshotOptions = { clip, ...renderConfig }
      const buffer = await page.screenshot(screenshotOptions) as Buffer
      const imageType = renderConfig.type || 'png'
      return h.image(buffer, `image/${imageType}`).toString()
    })

    page.close()
    return output
  }
}

namespace Puppeteer {
  export const filter = false

  export const usage = `
  ---
    
  本插件提供浏览器 API 服务，主要用于网页截图、生成图片等功能。
  
  **重要提示：**
  
  1.  **浏览器环境要求：** 为确保插件正常运行，请确保您的系统已安装 Chromium 浏览器，或已配置远程浏览器服务。
  2.  **版本匹配：** 建议保持 Chromium/Chrome 浏览器与本插件同步更新，以避免因版本不匹配导致的功能异常。
  3.  **Windows 系统兼容性：** 如果您在 Windows 服务器上运行，为支持最新版 Puppeteer 及其捆绑的 Chromium，您的操作系统至少需要是 **Windows Server 2016 或更高版本**。Windows Server 2012 R2 及更早版本已无法满足最新 Chrome 的运行要求。
  
  ---
  `;

  type LaunchOptions = Parameters<typeof puppeteer.launch>[0] & {}
  export type ImageType = 'png' | 'jpeg' | 'webp'

  export interface Config extends LaunchOptions, ConnectOptions {
    enablePuppeteer?: boolean
    enableCanvas?: boolean
    remote?: boolean
    endpoint?: string
    headers?: Record<string, string>
    render?: {
      type?: ImageType
      quality?: number
    }
  }

  export const Config = Schema.intersect([
    Schema.object({
      remote: Schema.boolean().description('是否连接到远程浏览器。').default(false),
    }).description('连接设置'),
    Schema.union([
      Schema.object({
        remote: Schema.const(true).required(),
        endpoint: Schema.string().description(
          '远程浏览器的端点。<br>' +
          '例：WebSocket URL:  `ws://localhost:14550/devtools/browser/[id]`'
        ).required(),
        headers: Schema.dict(String).role('table').description(
          '连接到远程浏览器时使用的 HTTP 请求头。<br>' +
          '注意：这与本地模式的 `args` 不同，headers 只影响连接请求，不影响浏览器本身的行为。<br>' +
          '常用于设置身份验证、API密钥或自定义标识等。详细示例请参考 README。'
        ),
      }),
      Schema.object({
        remote: Schema.const(false).default(false),
        executablePath: Schema.string().description(
          'Chrome/Chromium 可执行文件的路径。<br>' +
          '如果不指定，将自动从系统中查找。<br>' +
          '如果自动查找失败，请手动指定此路径。'
        ),
        headless: Schema.boolean().description('是否开启[无头模式](https://developer.chrome.com/blog/headless-chrome/)。无头模式下浏览器不会显示界面。').default(true),
        args: Schema.array(String)
          .description(
            '启动 Chrome/Chromium 浏览器时传递的命令行参数。<br>' +
            '常用参数：' +
            '- `--no-sandbox`: 禁用沙箱（在 Docker 或 root 用户下常用）<br>' +
            '- `--disable-gpu`: 禁用 GPU 加速<br>' +
            '更多 [Chromium 参数请参考这个页面](https://peter.sh/experiments/chromium-command-line-switches/)。'
          )
          .default(process.getuid?.() === 0 ? ["--no-sandbox", "--disable-gpu"] : []),
      }),
    ]),

    Schema.object({
      enablePuppeteer: Schema.boolean().description('是否注册 puppeteer 服务。').default(true),
      enableCanvas: Schema.boolean().description('是否注册 canvas 服务。（默认关闭。）<br>注意: 这与[`koishi-plugin-canvas`](/market?keyword=koishi-plugin-canvas+email:shigma10826@gmail.com+email:void@anillc.cn+email:i.dlist@outlook.com)的`canvas`服务同名 但API不一致。').default(false),
    }).description('功能设置'),

    Schema.object({
      render: Schema.intersect([
        Schema.object({
          type: Schema.union(['png', 'jpeg', 'webp'] as const).description('默认渲染的图片类型。').default('png'),
        }),
        Schema.union([
          Schema.object({
            type: Schema.const('png'),
          }),
          Schema.object({
            quality: Schema.number().min(0).max(100).step(1).description('默认渲染的图片质量。').default(80),
          }),
        ]),
      ]),
    }).description('渲染设置'),

    Schema.object({
      defaultViewport: Schema.object({
        width: Schema.natural().description('默认的视图宽度。').default(1280),
        height: Schema.natural().description('默认的视图高度。').default(768),
        deviceScaleFactor: Schema.number().min(0).description('默认的设备缩放比率。').default(2),
      }),
      ignoreHTTPSErrors: Schema.boolean().description('在导航时忽略 HTTPS 错误。').default(false),
    }).description('浏览器设置'),
  ]) as Schema<Config>
}

export default Puppeteer
