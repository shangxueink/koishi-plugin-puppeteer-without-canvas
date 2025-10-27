import puppeteer, { Browser, ConnectOptions, ElementHandle, GoToOptions, Page } from 'puppeteer-core'
import { Context, h, hyphenate, Schema, Service } from 'koishi'
import { SVG, SVGOptions } from './svg'
import find from 'puppeteer-finder'
import Canvas from './canvas'
import { FontServer } from './font-server'

import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { } from '@cordisjs/plugin-proxy-agent'
import { } from 'koishi-plugin-fonts'

export * from './svg'

declare module 'koishi' {
  interface Context {
    puppeteer: Puppeteer
  }
}

type RenderCallback = (page: Page, next: (handle?: ElementHandle) => Promise<string>) => Promise<string>

export async function injectDefaultFont(page: Page, ctx: Context, config: Puppeteer.Config, fontUrl?: string) {
  if (!config.enableFont) {
    return
  }

  if (!fontUrl) {
    return
  }

  try {
    if (config.enableFontCache) { // 这个配置项只会是开启的
      await page.evaluateOnNewDocument((fontPath: string) => {
        // Service Worker
        const serviceWorkerScript = `
          const CACHE_NAME = 'koishi-font-cache-v1';
          const FONT_URL = '${fontPath}';

          self.addEventListener('install', (event) => {
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => {
                return cache.add(FONT_URL);
              })
            );
          });

          self.addEventListener('fetch', (event) => {
            if (event.request.url === FONT_URL) {
              event.respondWith(
                caches.match(event.request).then((response) => {
                  return response || fetch(event.request);
                })
              );
            }
          });
        `;

        // 注册 Service Worker
        if ('serviceWorker' in navigator) {
          const blob = new Blob([serviceWorkerScript], { type: 'application/javascript' });
          const serviceWorkerUrl = URL.createObjectURL(blob);

          navigator.serviceWorker.register(serviceWorkerUrl).then((registration) => {
            // console.log('字体缓存 Service Worker 注册成功:', registration);
          }).catch((error) => {
            console.error('字体缓存 Service Worker 注册失败:', error);
          });
        }
      }, fontUrl);
    }

    await page.addStyleTag({
      content: `
        @font-face {
          font-family: "KoishiDefaultFont";
          src: url("${fontUrl}") format("truetype");
          font-display: swap;
        }
      `
    })

    // 根据注入模式决定是否需要检查页面字体
    let shouldInject = true

    if (config.fontInjectMode === 'smart') {
      const hasAnyFontFamily = await page.evaluate(() => {
        for (let i = 0; i < document.styleSheets.length; i++) {
          try {
            const styleSheet = document.styleSheets[i]
            if (styleSheet.cssRules) {
              for (let j = 0; j < styleSheet.cssRules.length; j++) {
                const rule = styleSheet.cssRules[j]
                if (rule instanceof CSSStyleRule && rule.style.fontFamily) {
                  return true
                }
              }
            }
          } catch (e) {
            // 跨域样式表可能无法访问，忽略错误
          }
        }

        const elementsWithInlineFont = document.querySelectorAll('[style*="font-family"]')
        if (elementsWithInlineFont.length > 0) {
          return true
        }

        return false
      })

      // 判断模式：只有在页面没有设置字体时才注入
      shouldInject = !hasAnyFontFamily
    }

    // force 模式：shouldInject 保持为 true，无条件注入

    // 根据判断结果决定是否注入字体样式
    if (shouldInject) {
      await page.addStyleTag({
        content: `
          /* 全局应用默认字体 */
          *, *::before, *::after {
            font-family: "KoishiDefaultFont" !important;
          }
          
          html, body, div, span, p, h1, h2, h3, h4, h5, h6,
          input, textarea, button, select, option, canvas {
            font-family: "KoishiDefaultFont" !important;
          }
        `
      })

      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          // 检查字体加载
          const checkFont = () => {
            if (document.fonts && document.fonts.check) {
              try {
                const fontLoaded = document.fonts.check('16px "KoishiDefaultFont"')
                if (fontLoaded) {
                  resolve()
                  return
                }
              } catch (e) {
                // 如果 check 方法失败，继续使用其他方法
              }
            }

            // 备用方法：等待 document.fonts.ready
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(() => {
                setTimeout(resolve, 100)
              }).catch(() => {
                setTimeout(resolve, 500)
              })
            } else {
              setTimeout(resolve, 500)
            }
          }

          // 立即检查一次
          checkFont()
        })
      })
    }
    // 如果页面已经设置了 font-family，则不注入任何字体样式
  } catch (error) {
    ctx.logger.error('默认字体注入失败:', error.message)
  }
}

class Puppeteer extends Service {
  static [Service.provide] = 'puppeteer'
  static inject = ['http']

  browser: Browser
  executable: string
  private browserWSEndpoint: string
  private activePageCount: number = 0
  private fontServer: FontServer

  constructor(ctx: Context, public config: Puppeteer.Config) {
    super(ctx, 'puppeteer')
    if (this.config.enableCanvas !== false) {
      ctx.plugin(Canvas)
    }

    // 初始化字体服务器
    this.fontServer = new FontServer(ctx)

    // 根据配置注册 HTML 组件
    if (this.config.registerHtmlComponent) {
      this.registerHtmlComponent()
    }

    // 根据配置决定是否注册重启指令
    if (this.config.enableRestartCommand !== false && !this.config.immediateClose) {
      ctx.command('puppeteer.restart', '重启 Puppeteer 浏览器服务')
        .action(async ({ session }) => {
          try {
            await session?.send('正在重启 Puppeteer 服务...')

            // 停止当前浏览器实例和字体服务器
            await this.stopBrowser()
            await this.stopFontServer()

            // 重新启动浏览器和字体服务器
            await this.startBrowser()
            await this.startFontServer()

            return '✅ Puppeteer 服务重启成功'
          } catch (error) {
            ctx.logger.error('Puppeteer 服务重启失败:', error)
            return `❌ Puppeteer 服务重启失败: ${error.message}`
          }
        })
    } else if (this.config.immediateClose && this.config.enableRestartCommand !== false) {
      ctx.logger.warn('immediateClose 模式下 puppeteer.restart 指令已被禁用')
    }
  }

  private getFontCacheDir(customDir?: string): string {
    if (customDir && customDir.trim()) {
      // 使用用户指定的目录
      const dir = resolve(customDir.trim())
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      return dir
    }

    // 使用默认目录
    const defaultDir = join(tmpdir(), '.koishi-puppeteer-userDataDir');
    if (!existsSync(defaultDir)) {
      mkdirSync(defaultDir, { recursive: true })
    }
    return defaultDir
  }

  private registerHtmlComponent() {
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

      // 确保浏览器已连接
      await this.ensureConnected()

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
          // setContent 后重新注入默认字体
          const fontUrl = this.getFontUrl()
          await injectDefaultFont(page, this.ctx, this.config, fontUrl)
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

  async start() {
    // 如果启用了立即关闭模式，则不在启动时初始化浏览器
    if (!this.config.immediateClose) {
      await this.startBrowser()
    }

    // 启动字体服务器（如果配置了字体路径）
    await this.startFontServer()
  }

  private async startBrowser() {
    const { remote, endpoint, executablePath, headers, headless, args = [], enableTempUserDataDir, TempUserDataDir, ...config } = this.config

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

          // 保存 WebSocket 端点，无论是直接提供的还是从 HTTP URL 获取的
          if (connectOptions.browserWSEndpoint) {
            this.browserWSEndpoint = connectOptions.browserWSEndpoint
          } else if (this.browser.wsEndpoint) {
            // 如果使用 HTTP URL，从浏览器实例获取 WebSocket 端点
            this.browserWSEndpoint = this.browser.wsEndpoint()
            this.ctx.logger.debug('从 HTTP URL 获取 WebSocket 端点: %c', this.browserWSEndpoint)
          }
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

          // 准备启动选项
          const launchOptions: any = {
            executablePath: this.executable,
            headless,
            args: localArgs,
            ...config
          }

          // 固定用户数据目录
          if (enableTempUserDataDir) {
            const userDataDir = this.getFontCacheDir(TempUserDataDir)
            launchOptions.userDataDir = userDataDir
            this.ctx.logger.info('用户数据目录: %c', userDataDir)
          }

          this.browser = await puppeteer.launch(launchOptions)
          this.browserWSEndpoint = this.browser.wsEndpoint()
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
  }

  async stop() {
    await this.stopBrowser()
    await this.stopFontServer()
  }

  private async stopBrowser() {
    try {
      if (this.browser) {
        if (this.config.remote) {
          await this.browser.disconnect()
        } else {
          await this.browser.close()
        }
        this.browser = null
        this.browserWSEndpoint = null
        this.activePageCount = 0
      }
    } catch (error) {
      this.ctx.logger.warn('停止浏览器时出现错误:', error.message)
    }
  }

  // 检查并关闭浏览器
  private async checkAndCloseBrowser() {
    if (!this.config.immediateClose) return

    if (this.activePageCount <= 0 && this.browser) {
      try {
        // 获取所有页面
        const pages = await this.browser.pages()

        // 检查是否只剩下空白页（about:blank）
        const nonBlankPages = pages.filter(page => page.url() !== 'about:blank')

        if (nonBlankPages.length === 0) {
          this.ctx.logger.debug('所有页面已关闭，正在关闭浏览器连接')
          await this.stopBrowser()
        }
      } catch (error) {
        this.ctx.logger.warn('检查浏览器状态时出现错误:', error.message)
      }
    }
  }

  // 检查浏览器连接状态并尝试重连
  private async ensureConnected() {
    // 如果启用了立即关闭模式，且浏览器未连接，则启动浏览器
    if (this.config.immediateClose && (!this.browser || !this.browser.connected)) {
      await this.startBrowser()
      return
    }

    // 如果浏览器已连接，直接返回
    if (this.browser && this.browser.connected) return

    // 如果未启用重连，则抛出异常
    if (this.config.enableReconnect === false) {
      throw new Error('浏览器连接已断开，且未启用自动重连')
    }

    // 检查是否有可用的重连端点
    const hasReconnectEndpoint = this.browserWSEndpoint || this.config.endpoint
    if (!hasReconnectEndpoint) {
      throw new Error('浏览器连接已断开，且没有可用的重连端点')
    }

    // 尝试重连，使用配置的最大重试次数
    let retryCount = 0
    const maxRetries = this.config.maxReconnectRetries ?? 3

    while (retryCount < maxRetries) {
      try {
        this.ctx.logger.info(`浏览器连接已断开，尝试重新连接... (尝试 ${retryCount + 1}/${maxRetries})`)

        // 如果设置了重连间隔，则等待指定时间
        if (this.config.reconnectInterval > 0) {
          await new Promise(resolve => setTimeout(resolve, this.config.reconnectInterval))
        }

        // 准备连接选项
        const connectOptions: ConnectOptions = { ...this.config }

        // 优先使用保存的 WebSocket 端点，如果没有则使用配置的端点
        if (this.browserWSEndpoint) {
          connectOptions.browserWSEndpoint = this.browserWSEndpoint
          this.ctx.logger.debug('使用保存的 WebSocket 端点重连: %c', this.browserWSEndpoint)
        } else if (this.config.endpoint) {
          // 检查端点类型
          try {
            const endpointURL = new URL(this.config.endpoint)
            if (['ws:', 'wss:'].includes(endpointURL.protocol)) {
              connectOptions.browserWSEndpoint = this.config.endpoint
              this.ctx.logger.debug('使用配置的 WebSocket 端点重连: %c', this.config.endpoint)
            } else if (['http:', 'https:'].includes(endpointURL.protocol)) {
              connectOptions.browserURL = this.config.endpoint
              this.ctx.logger.debug('使用配置的 HTTP 端点重连: %c', this.config.endpoint)
            }
          } catch (e) {
            this.ctx.logger.warn('解析端点 URL 失败: %c', e.message)
          }
        }

        // 尝试重新连接
        this.browser = await puppeteer.connect(connectOptions)

        // 检查连接是否成功
        if (this.browser.connected) {
          this.ctx.logger.info('浏览器重新连接成功')

          // 保存新的 WebSocket 端点
          if (this.browser.wsEndpoint) {
            this.browserWSEndpoint = this.browser.wsEndpoint()
            this.ctx.logger.debug('保存新的 WebSocket 端点: %c', this.browserWSEndpoint)
          }

          return
        } else {
          throw new Error('连接后浏览器状态仍为断开')
        }
      } catch (e) {
        retryCount++

        // 检查是否是 404 错误，如果是，则尝试使用原始配置重新连接
        if (e.message?.includes('404') || e.message?.includes('Unexpected server response: 404')) {
          this.ctx.logger.warn('检测到 404 错误，尝试使用原始配置重新连接')

          try {
            // 重置端点信息
            this.browserWSEndpoint = null

            // 使用原始配置重新连接
            const originalOptions: ConnectOptions = { ...this.config }
            if (this.config.endpoint) {
              const endpointURL = new URL(this.config.endpoint)
              if (['ws:', 'wss:'].includes(endpointURL.protocol)) {
                originalOptions.browserWSEndpoint = this.config.endpoint
              } else if (['http:', 'https:'].includes(endpointURL.protocol)) {
                originalOptions.browserURL = this.config.endpoint
              }
            }

            this.browser = await puppeteer.connect(originalOptions)

            // 检查连接是否成功
            if (this.browser.connected) {
              this.ctx.logger.info('使用原始配置重新连接成功')

              // 保存新的 WebSocket 端点
              if (this.browser.wsEndpoint) {
                this.browserWSEndpoint = this.browser.wsEndpoint()
                this.ctx.logger.debug('保存新的 WebSocket 端点: %c', this.browserWSEndpoint)
              }

              return
            }
          } catch (reconnectError) {
            this.ctx.logger.warn('使用原始配置重新连接失败:', reconnectError.message)
          }
        }

        if (retryCount >= maxRetries) {
          this.ctx.logger.error(`浏览器重新连接失败 (${retryCount}/${maxRetries}):`, e.message)
          throw new Error(`浏览器重新连接失败: ${e.message}`)
        } else {
          this.ctx.logger.warn(`浏览器重新连接失败，将重试 (${retryCount}/${maxRetries}):`, e.message)
          // 增加重试间隔
          await new Promise(resolve => setTimeout(resolve, this.config.reconnectInterval * retryCount))
        }
      }
    }
  }

  // 启动字体服务器
  private async startFontServer() {
    if (this.config.enableFont && this.config.fontPath) {
      try {
        await this.fontServer.start(this.config.fontPath)
      } catch (error) {
        this.ctx.logger.error('字体服务器启动失败:', error.message)
      }
    }
  }

  // 停止字体服务器
  private async stopFontServer() {
    try {
      await this.fontServer.stop()
    } catch (error) {
      this.ctx.logger.warn('停止字体服务器时出现错误:', error.message)
    }
  }

  // 获取字体 URL
  private getFontUrl(): string | null {
    if (!this.config.enableFont || !this.config.fontPath) {
      return null
    }

    if (this.fontServer.isRunning()) {
      return this.fontServer.getFontUrl()
    }

    return null
  }

  page = async (options?: Puppeteer.PageOptions) => {
    let page
    try {
      // 确保浏览器已连接
      await this.ensureConnected()

      // 创建新页面
      page = await this.browser.newPage()

      // 注入默认字体
      const fontUrl = this.getFontUrl()
      await injectDefaultFont(page, this.ctx, this.config, fontUrl)

      const originalSetContent = page.setContent.bind(page)
      page.setContent = async (html: string, options?: any) => {
        const result = await originalSetContent(html, options)
        // setContent 后重新注入默认字体
        const fontUrl = this.getFontUrl()
        await injectDefaultFont(page, this.ctx, this.config, fontUrl)
        return result
      }

      // 如果启用了立即关闭模式
      // 包装 close 方法
      if (this.config.immediateClose) {
        this.activePageCount++
        const originalClose = page.close.bind(page)
        page.close = async () => {
          await originalClose()
          this.activePageCount--
          await this.checkAndCloseBrowser()
        }
      }

      if (options) {
        if (options?.beforeGotoPage) {
          await options.beforeGotoPage(page)
        }
        await page.goto(`${pathToFileURL(options.url)}`, options?.gotoOptions)
        if (options?.content) {
          await page.setContent(options.content)
          // setContent 后重新注入默认字体
          const fontUrl = this.getFontUrl()
          await injectDefaultFont(page, this.ctx, this.config, fontUrl)
        }
        if (options?.families?.length && this.ctx.fonts) {
          try {
            const fonts = await this.ctx.fonts.get(options.families)
            await Promise.all(fonts.map(async (font) => {
              if (font.format === 'google') {
                await page.addStyleTag({ content: `@import url('${font.path}')` })
              } else {
                await page.evaluate((font) => {
                  const fontFace = new FontFace(
                    font.family,
                    `url(${font.path}) format('${font.format}')`,
                    font.descriptors,
                  )
                  document.fonts.add(fontFace)
                }, font)
              }
            }))
          } catch (e) {
            this.ctx.logger.warn('加载字体失败，将使用系统默认字体：', e.message)
          }
        }
      }
    } catch (err) {
      if (page) {
        await page.close()
      }
      this.ctx.logger.error('failed to create page: %s', err)
      throw err
    }
    return page
  }

  svg = async (options?: SVGOptions) => {
    // 确保浏览器已连接
    await this.ensureConnected()
    return new SVG(options)
  }

  render = async (content: string, callback?: RenderCallback, families?: string[]) => {
    // 确保浏览器已连接
    await this.ensureConnected()

    const url = resolve(__dirname, '../index.html')
    const page = await this.page({ url, content, families })
    const renderConfig = this.config.render || {}

    if (families?.length) {
      try {
        await page.addStyleTag({ content: `* {font-family: ${families.map((f) => `'${f}'`).join(', ')};}` })
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise(resolve => setTimeout(resolve, 100))
        })
      } catch (e) {
        this.ctx.logger.warn('应用字体样式失败：', e.message)
      }
    }

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
  export interface PageOptions {
    beforeGotoPage?: (page: Page) => Promise<void>
    url: string
    gotoOptions?: GoToOptions
    content?: string
    families?: string[]
  }

  export const filter = false;

  export const usage = `
---

本插件提供浏览器 API 服务，主要用于网页截图、生成图片等功能。

**重要提示：**

1.  **浏览器环境要求：** 为确保插件正常运行，请确保您的系统已安装 Chromium 浏览器，或已配置远程浏览器服务。
2.  **版本匹配：** 建议保持 Chromium/Chrome 浏览器与本插件同步更新，以避免因版本不匹配导致的功能异常。
3.  **Windows 系统兼容性：** 如果您在 Windows 服务器上运行，为支持最新版 Puppeteer 及其捆绑的 Chromium，您的操作系统至少需要是 **Windows Server 2016 或更高版本**。

注意： Windows Server 2012 R2 及更早版本已无法满足最新 Chrome 的运行要求。

---


**服务依赖：**

- **必需服务：** http（自带服务，无需额外安装）
- **可选服务：** [fonts](/market?keyword=font+email:shigma10826@gmail.com+email:saarchaffee@qq.com)

---

<p>➣ <a href="https://github.com/shangxueink/koishi-plugin-puppeteer-without-canvas" target="_blank">点我前往项目地址</a></p>

---
  `;

  type LaunchOptions = Parameters<typeof puppeteer.launch>[0] & {}
  export type ImageType = 'png' | 'jpeg' | 'webp'

  export interface Config extends LaunchOptions, ConnectOptions {
    enablePuppeteer?: boolean
    enableCanvas?: boolean
    registerHtmlComponent?: boolean
    enableRestartCommand?: boolean
    remote?: boolean
    endpoint?: string
    headers?: Record<string, string>
    enableReconnect?: boolean
    reconnectInterval?: number
    maxReconnectRetries?: number
    immediateClose?: boolean
    enableFont?: boolean
    fontPath?: string
    fontInjectMode?: 'force' | 'smart'
    enableFontCache?: boolean
    enableTempUserDataDir?: boolean
    TempUserDataDir?: string
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
          '例：<br>' +
          'WebSocket URL:  `ws://localhost:14550/devtools/browser/[id]`<br>' +
          'HTTP URL:  `http://localhost:14550`<br>'
        ).required(),
        headers: Schema.dict(String).role('table').description(
          '连接到远程浏览器时使用的 HTTP 请求头。<br>' +
          '注意：这与本地模式的 `args` 不同，headers 只影响连接请求，不影响浏览器本身的行为。<br>' +
          '常用于设置身份验证、API密钥或自定义标识等。详细示例请参考 README。'
        ),
      }).description('远程浏览器设置'),
      Schema.object({
        remote: Schema.const(false).default(false),
        executablePath: Schema.string().description(
          '`Chrome/Chromium 可执行文件`的路径。一般无需指定。<br>' +
          '如果不指定，将自动从系统中查找。<br>' +
          '如果自动查找失败，请手动指定此路径。'
        ),
        headless: Schema.boolean().description('是否开启[无头模式](https://developer.chrome.com/blog/headless-chrome/)。无头模式下浏览器不会显示界面。').default(true),
        immediateClose: Schema.boolean().description('是否在渲染完成后 立即关闭浏览器连接。<br>启用后 会增加每次渲染的启动时间。适用于低频率渲染场景。').default(false).experimental(),
        args: Schema.array(String)
          .description(
            '启动 Chrome/Chromium 浏览器时传递的命令行参数。<br>' +
            '常用参数：<br>' +
            '`--no-sandbox`: 禁用沙箱（在 Docker 或 root 用户下常用）<br>' +
            '`--disable-gpu`: 禁用 GPU 加速<br>' +
            '更多 [Chromium 参数请参考这个页面](https://peter.sh/experiments/chromium-command-line-switches/)。'
          )
          .default(process.getuid?.() === 0 ? ["--no-sandbox", "--disable-gpu", "--disable-web-security"] : ["--disable-web-security"]),
      }).description('本地浏览器设置'),
    ]),

    Schema.object({
      enablePuppeteer: Schema.boolean().description('是否注册 puppeteer 服务。').default(true),
      enableCanvas: Schema.boolean().description('是否注册 canvas 服务。（默认关闭。）<br>注意: 这与[`koishi-plugin-canvas`](/market?keyword=koishi-plugin-canvas+email:shigma10826@gmail.com+email:void@anillc.cn+email:i.dlist@outlook.com)的`canvas`服务同名 但API不一致。').default(false),
      registerHtmlComponent: Schema.boolean().description('是否注册 `component:html` 服务。<br>注意: 启用后会覆盖 Koishi 的默认 `html` 组件行为。').default(true),
    }).description('服务注册'),

    Schema.object({
      enableRestartCommand: Schema.boolean().description('是否注册 `puppeteer.restart` 重启指令。启用后可通过指令重启浏览器服务。').default(false),
      enableReconnect: Schema.boolean().description('是否启用浏览器自动重连功能。当浏览器连接断开时，会尝试重新连接。').default(true),
      reconnectInterval: Schema.number().description('浏览器重连尝试的间隔时间（毫秒）。').default(1000),
      maxReconnectRetries: Schema.number().description('浏览器重连最大尝试次数。').default(3),
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
      enableTempUserDataDir: Schema.boolean().description('是否固定用户数据目录。<br>- 需要使用本地浏览器。远程浏览器无效。').default(false).experimental(),
    }).description('浏览器设置'),
    Schema.union([
      Schema.object({
        enableTempUserDataDir: Schema.const(false)
      }),
      Schema.object({
        enableTempUserDataDir: Schema.const(true).required(),
        TempUserDataDir: Schema.string().experimental().default(null)
          .description('用户数据目录路径。建议保持默认值。<br>默认目录:系统`temp`目录下的 `.koishi-puppeteer-userDataDir`。'),
      }),
    ]),

    Schema.object({
      enableFont: Schema.boolean().description('是否为页面注入字体。<br>- 此功能仅在本地浏览器生效。远程浏览器无效。').default(false).experimental(),
      enableFontCache: Schema.boolean().description('是否启用字体 Service Worker 缓存。启用后将在页面中注册 Service Worker 来缓存字体文件。').default(true).hidden(),
    }).description('字体注入设置'),
    Schema.union([
      Schema.object({
        enableFont: Schema.const(true).required(),
        fontPath: Schema.path({
          filters: [{ name: '字体文件', extensions: ['.ttf', '.otf', '.woff', '.woff2', '.ttc'] }],
          allowCreate: true
        }).experimental().default(null)
          .description('字体文件路径。支持的格式：`.ttf`, `.otf`, `.woff`, `.woff2`, `.ttc`<br>例：`data/fonts/NotoColorEmoji-Regular.ttf`<br>实验性功能：渲染字体时会加载到内存里，此功能会显著增加渲染内存占用。'),
        fontInjectMode: Schema.union([
          Schema.const('smart').description('1.判断注入'),
          Schema.const('force').description('2.强制注入'),
        ]).default('smart').experimental()
          .description('字体注入模式。<br>1.判断注入，仅在页面未设置字体时注入<br>2.强制注入，无论页面是否已设置字体都会注入'),
      }),
      Schema.object({
        enableFont: Schema.const(false)
      }),
    ]),

  ]) as Schema<Config>
}

export default Puppeteer
