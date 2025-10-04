import CanvasService, { Canvas, CanvasRenderingContext2D, Image } from '@koishijs/canvas'
import { Awaitable, Binary, Context, h } from 'koishi'
import { ElementHandle, Page } from 'puppeteer-core'

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { } from 'koishi-plugin-fonts'

import { injectDefaultFont } from './index'

const kElement = Symbol('element')

class BaseElement {
  public [kElement] = true

  constructor(protected page: Page, protected id: string) { }

  get selector() {
    return `document.querySelector("#${this.id}")`
  }

  async dispose() {
    await this.page.evaluate(`${this.selector}?.remove()`)
    this.id = null
  }
}

class CanvasElement extends BaseElement implements Canvas {
  private stmts: string[] = []
  private ctx = new Proxy({
    canvas: this,
    direction: 'inherit',
    fillStyle: '#000000',
    filter: 'none',
    font: '10px sans-serif',
    fontKerning: 'auto',
    fontStretch: 'normal',
    fontVariantCaps: 'normal',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    letterSpacing: '0px',
    lineCap: 'butt',
    lineDashOffset: 0,
    lineJoin: 'miter',
    lineWidth: 1,
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeStyle: '#000000',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    textRendering: 'auto',
    wordSpacing: '0px',
  } as unknown as CanvasRenderingContext2D, {
    get: (target, prop, receiver) => {
      if (Reflect.has(target, prop) || typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }
      return new Proxy(() => { }, {
        apply: (target, thisArg, argArray) => {
          this.stmts.push(`ctx.${prop}(${argArray.map((value) => {
            if (value[kElement]) return value.selector
            return JSON.stringify(value)
          }).join(', ')});`)
        },
      })
    },
    set: (target, prop, value, receiver) => {
      if (Reflect.has(target, prop)) {
        if (typeof prop !== 'symbol') {
          this.stmts.push(`ctx.${prop} = ${JSON.stringify(value)};`)
        }
        return Reflect.set(target, prop, value, receiver)
      }
    },
  })

  constructor(
    page: Page,
    id: string,
    public width: number,
    public height: number,
    private fontFaceSet: FontFace[] = [],
    private styleHandles: ElementHandle<Element>[] = [],
  ) {
    super(page, id)
  }

  getContext(type: '2d') {
    return this.ctx
  }

  async toDataURL(type: 'image/png') {
    if (!this.id) throw new Error('canvas has been disposed')
    try {
      this.stmts.unshift(`(async (ctx) => {`)
      const expr = this.stmts.join('\n  ') + `\n})(${this.selector}.getContext('2d'))`
      this.stmts = []
      await this.page.evaluate(expr)
      return await this.page.evaluate(`${this.selector}.toDataURL(${JSON.stringify(type)})`) as string
    } catch (err) {
      await this.dispose()
      throw err
    }
  }

  async toBuffer(type: 'image/png') {
    const url = await this.toDataURL(type)
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  }

  async dispose() {
    await super.dispose()
    await Promise.all(this.fontFaceSet.map(async (fontFace) => {
      await this.page.evaluate((fontFace) => {
        document.fonts.delete(fontFace)
      }, fontFace)
    }))
    await Promise.all(this.styleHandles.map(async (handle) => {
      try {
        await handle.evaluate(node => node.remove())
        await handle.dispose()
      } catch (e) { }
    }))
  }
}

class ImageElement extends BaseElement implements Image {
  public naturalHeight: number
  public naturalWidth: number

  constructor(
    private ctx: Context,
    page: Page,
    id: string,
    private source: string | URL | Buffer | ArrayBufferLike,
    private type?: string,
  ) {
    super(page, id)
  }

  async initialize() {
    let base64: string
    if (this.source instanceof URL) {
      this.source = this.source.href
    }
    if (typeof this.source === 'string') {
      const file = await this.ctx.http.file(this.source)
      base64 = Binary.toBase64(file.data)
    } else if (Buffer.isBuffer(this.source)) {
      base64 = this.source.toString('base64')
    } else {
      base64 = Binary.toBase64(this.source)
    }
    const size = await this.page.evaluate(`loadImage(${JSON.stringify(this.id)}, ${JSON.stringify(base64)}, ${JSON.stringify(this.type)})`) as any
    this.naturalWidth = size.width
    this.naturalHeight = size.height
  }
}

export default class extends CanvasService {
  static inject = ['puppeteer', 'http']

  private page: Page
  private counter = 0

  async start() {
    const page = await this.ctx.puppeteer.page()
    try {
      await page.goto(pathToFileURL(resolve(__dirname, '../index.html')).href)
      // 注入默认字体到 Canvas 页面
      await injectDefaultFont(page, this.ctx, this.ctx.puppeteer.config)
      this.page = page
    } catch (err) {
      await page.close()
      throw err
    }
  }

  async stop() {
    await this.page?.close()
    this.page = null
  }

  async createCanvas(
    width: number,
    height: number,
    options?: {
      families: string[]
      text?: string
    },
  ) {
    const fontFaceSet = []
    const styleHandles = []
    try {
      const name = `canvas_${++this.counter}`
      if (options && options.families.length && this.ctx.fonts) {
        try {
          const fonts = await this.ctx.fonts.get(options.families)
          await Promise.all(fonts.map(async (font) => {
            if (font.format === 'google') {
              const style = await this.page.addStyleTag({ url: font.path })
              styleHandles.push(style)
            } else {
              await this.page.evaluate((font, fontFaceSet) => {
                const fontFace = new FontFace(
                  font.family,
                  `url(${font.path}) format('${font.format}')`,
                  font.descriptors,
                )
                document.fonts.add(fontFace)
                fontFaceSet.push(fontFace)
              }, font, fontFaceSet)
            }
          }))
          if (options?.text) {
            await this.page.evaluate(async (text, families) => {
              await document.fonts.load(
                `1px ${families.join(',')}`,
                text,
              )
            }, options.text, options.families)
          }
        } catch (e) {
          this.ctx.logger('puppeteer').warn('加载字体失败，将使用系统默认字体：', e.message)
        }
      }
      await this.page.evaluate([
        `const ${name} = document.createElement('canvas');`,
        `${name}.width = ${width};`,
        `${name}.height = ${height};`,
        `${name}.id = ${JSON.stringify(name)};`,
        `document.body.appendChild(${name});`,
      ].join('\n'))
      return new CanvasElement(this.page, name, width, height, fontFaceSet, styleHandles)
    } catch (err) {
      this.ctx.logger('puppeteer').warn(err)
      throw err
    }
  }

  async render(
    width: number,
    height: number,
    callback: (ctx: CanvasRenderingContext2D) => Awaitable<void>,
    options?: {
      families: string[]
      text?: string
    },
  ) {
    let canvas: CanvasElement
    try {
      canvas = await this.createCanvas(width, height, options)
      await callback(canvas.getContext('2d'))
      const buffer = await canvas.toBuffer('image/png')
      return h.image(buffer, 'image/png')
    } catch (err) {
      this.ctx.logger('puppeteer').warn(err)
      throw err
    } finally {
      try {
        await canvas.dispose()
      } catch (err) {
        this.ctx.logger('puppeteer').warn(err)
      }
    }
  }

  async loadImage(source: string | URL | Buffer | ArrayBufferLike, type?: string): Promise<Image> {
    const id = `image_${++this.counter}`
    const image = new ImageElement(this.ctx, this.page, id, source, type)
    await image.initialize()
    return image
  }

}