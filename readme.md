# @shangxueink/koishi-plugin-puppeteer-without-canvas

[![npm](https://img.shields.io/npm/v/@shangxueink/koishi-plugin-puppeteer-without-canvas?style=flat-square)](https://www.npmjs.com/package/@shangxueink/koishi-plugin-puppeteer-without-canvas)

为 Koishi 提供 Puppeteer 服务，支持本地浏览器和远程浏览器连接。

## 功能特点

- 支持本地启动 Chrome/Chromium 浏览器
- 支持连接远程浏览器实例
- 提供 HTML 渲染和截图功能
- 可选的 Canvas 服务集成
- 灵活的渲染配置选项

## 配置说明

### 基本配置

插件提供了两种工作模式：本地模式和远程模式。

#### 本地模式（默认）

在本地模式下，插件会自动启动 Chrome/Chromium 浏览器：

```js
{
  // 本地模式配置
  remote: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // 可选，自动查找
  headless: true, // 无头模式，不显示浏览器界面
  args: ['--no-sandbox', '--disable-gpu'], // 浏览器启动参数
  
  // 功能设置
  enableCanvas: true, // 是否启用 Canvas 服务
  
  // 渲染设置
  render: {
    type: 'png', // 图片类型：'png', 'jpeg', 'webp'
    quality: 80 // 图片质量 (仅适用于 jpeg 和 webp)
  },
  
  // 浏览器视图设置
  defaultViewport: {
    width: 1280,
    height: 768,
    deviceScaleFactor: 2
  }
}
```

#### 远程模式

在远程模式下，插件会连接到已经运行的浏览器实例：

```js
{
  // 远程模式配置
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c', // WebSocket URL
  // 或者使用 HTTP URL
  // endpoint: 'http://localhost:14550',
  
  // 其他配置与本地模式相同
  enableCanvas: true,
  render: { type: 'png' },
  defaultViewport: { width: 1280, height: 768, deviceScaleFactor: 2 }
}
```

### headers 配置示例

在远程模式下，可以使用 `headers` 配置项设置连接请求的 HTTP 头信息：

#### 基本身份验证

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "Authorization": "Basic dXNlcm5hbWU6cGFzc3dvcmQ=" // username:password 的 Base64 编码
  }
}
```

#### API 密钥认证

```js
{
  remote: true,
  endpoint: 'http://localhost:14550',
  headers: {
    "X-API-Key": "your-api-key-here"
  }
}
```

#### 自定义用户代理

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "User-Agent": "Koishi-Puppeteer/1.0"
  }
}
```

#### 多个头信息

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "Authorization": "Bearer token123",
    "X-Custom-Header": "custom-value",
    "Accept-Language": "zh-CN,zh;q=0.9"
  }
}
```

## 启动远程浏览器

我们提供了一个 Python 脚本来帮助启动远程浏览器实例。脚本位于 `test/chrome_remote_debug.py`。

### 使用方法

1. 确保已安装 Python
2. 运行脚本：`python test/chrome_remote_debug.py`
3. 脚本会启动 Chrome 浏览器并开启远程调试模式
4. 选择连接方式（WebSocket URL、HTTP URL 等）
5. 使用提供的配置信息在 Koishi 中设置插件

## 使用示例

### 渲染 HTML

```js
// 在插件或服务中使用
ctx.puppeteer.render('<div style="color: red">Hello World</div>')
  .then(image => {
    // 处理生成的图片
    console.log(image) // 返回 h.image 对象的字符串表示
  })
```


## 注意事项

1. 在 Docker 或 root 用户下运行时，建议添加 `--no-sandbox` 参数
2. 远程模式需要确保远程浏览器已启动并开启了调试模式
3. 如果自动查找 Chrome 失败，请手动指定 `executablePath`
4. 在远程模式下，`headers` 只影响连接请求，不影响浏览器本身的行为

## 许可证

MIT
## 
API 参考

### puppeteer.page()
### puppeteer.page(options?)

- **options:**
  - **beforeGotoPage:** `(page: Page) => Promise<void>` 页面跳转前的回调函数，负责执行一些[导航到页面之前要设置的操作](https://pptr.dev/search?q=before%20navigating%20to%20the)
  - **url:** `string` 页面地址
  - **gotoOptions:** [`GotoOptions`](https://pptr.dev/api/puppeteer.gotooptions) 页面跳转选项
  - **content:** `string` 要渲染的 HTML
  - **families:** `string[]` 字体名
- 返回值: `Promise<Page>`

创建一个新页面。

### puppeteer.render(content, callback?, families?)

- **content:** `string` 要渲染的 HTML
- **callback:** `(page, next) => Promise<string>` 回调函数
  - **page:** `Page` 页面实例
  - **next:** `(handle: ElementHandle) => Promise<string>` 渲染函数
- **families:** `string[]` 字体列表
- 返回值: `string`

渲染一个 HTML 页面，可以设置要渲染的字体。

### canvas.createCanvas(width, height, options?)

- **width:** `number` 画布宽度
- **height:** `number` 画布高度
- **options:**
  - **families:** `string[]` 字体列表
  - **text:** `string` 预加载的文本
- 返回值: `Canvas`

创建一个画布，可以设置要使用的字体。

### canvas.render(width, height, callback, options?)

- **width:** `number` 画布宽度
- **height:** `number` 画布高度
- **callback:** `(ctx: CanvasRenderingContext2D) => Awaitable<void>` 回调函数
- **options:**
  - **families:** `string[]` 字体列表
  - **text:** `string` 预加载的文本
- 返回值: `Element`

渲染一个画布，可以设置要使用的字体。