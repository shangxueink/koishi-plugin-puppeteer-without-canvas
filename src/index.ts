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

    if (remote) {
      const connectOptions: ConnectOptions = { headers, ...config }
      const endpointURL = new URL(endpoint)

      if (['ws:', 'wss:'].includes(endpointURL.protocol)) {
        if (!endpointURL.pathname.startsWith('/devtools/browser/')) {
          throw new Error('invalid browserWSEndpoint for remote debugging')
        }
        connectOptions.browserWSEndpoint = endpoint
      } else if (['http:', 'https:'].includes(endpointURL.protocol)) {
        connectOptions.browserURL = endpoint
      }

      this.browser = await puppeteer.connect(connectOptions)
      this.ctx.logger.info('remote connected to %c', endpoint)
    } else {
      // 查找可执行文件路径
      this.executable = executablePath || find()
      if (!this.executable) {
        throw new Error('Chrome executable not found. Please specify executablePath.')
      }

      if (!executablePath) {
        this.ctx.logger.info('chrome executable found at %c', this.executable)
      }

      // 处理代理设置
      const localArgs = [...args]
      const { proxyAgent } = this.ctx.http.config
      if (proxyAgent && !localArgs.some(arg => arg.startsWith('--proxy-server'))) {
        localArgs.push(`--proxy-server=${proxyAgent}`)
      }

      // 启动浏览器
      this.browser = await puppeteer.launch({
        executablePath: this.executable,
        headless,
        args: localArgs,
        ...config
      })
      this.ctx.logger.debug('browser launched')
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
        endpoint: Schema.string().description('远程浏览器的端点。<br>例：`ws://localhost:14550/devtools/browser/0f37d2e2-7518-41ff-b1f7-b42b2cab5b5c`').required(),
        headers: Schema.dict(String).role('table').description('连接到远程浏览器时使用的请求头。<br>注：与`args`配置项不一样，不是`浏览器启动的命令行参数`'),
      }),
      Schema.object({
        remote: Schema.const(false).default(false),
        executablePath: Schema.string().description('可执行文件的路径。缺省时将自动从系统中寻找。'),
        headless: Schema.boolean().description('是否开启[无头模式](https://developer.chrome.com/blog/headless-chrome/)。').default(true),
        args: Schema.array(String)
          .description('额外的浏览器参数。启动 Chrome/Chromium 浏览器时传递的命令行参数。<br>Chromium 参数可以参考[这个页面](https://peter.sh/experiments/chromium-command-line-switches/)。')
          .default(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      }),
    ]),

    Schema.object({
      enablePuppeteer: Schema.boolean().description('是否注册 puppeteer 服务。').default(true),
      enableCanvas: Schema.boolean().description('是否注册 canvas 服务。').default(false),
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
