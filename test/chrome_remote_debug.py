import subprocess
import time
import os
import sys
import signal
import atexit
import webbrowser
import json
import uuid
from urllib.request import urlopen
from urllib.error import URLError

# Chrome可执行文件路径
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# 远程调试端口
DEBUG_PORT = 14550
# 用户数据目录
USER_DATA_DIR = os.path.join(os.path.expanduser("~"), "chrome-remote-profile")

def start_chrome():
    """启动Chrome浏览器，开启远程调试模式"""
    print(f"启动Chrome，远程调试端口: {DEBUG_PORT}")
    
    # 确保用户数据目录存在
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    
    # 构建Chrome启动命令
    cmd = [
        CHROME_PATH,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized"
    ]
    
    # 启动Chrome进程
    process = subprocess.Popen(cmd)
    
    # 注册退出处理函数，确保脚本退出时关闭Chrome
    def cleanup():
        if process.poll() is None:
            print("关闭Chrome...")
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    
    atexit.register(cleanup)
    
    # 等待Chrome启动
    print("等待Chrome启动...")
    print("请等待启动后展示浏览器远程地址...")
    time.sleep(2)
    
    return process

def get_websocket_endpoint():
    """获取Chrome远程调试WebSocket端点"""
    try:
        # 尝试连接到Chrome远程调试API
        response = urlopen(f"http://localhost:{DEBUG_PORT}/json/version")
        data = json.loads(response.read().decode())
        websocket_url = data.get("webSocketDebuggerUrl")
        
        if websocket_url:
            print(f"WebSocket调试端点: {websocket_url}")
            return websocket_url
        else:
            print("无法获取WebSocket调试端点")
            return None
    except URLError as e:
        print(f"连接Chrome远程调试API失败: {e}")
        return None

def generate_endpoint_options(websocket_endpoint):
    """生成不同的端点选项"""
    options = []
    
    # 1. 标准WebSocket URL (带有 /devtools/browser/)
    options.append(websocket_endpoint)
    
    # 2. HTTP URL
    options.append(f"http://localhost:{DEBUG_PORT}")
    
    # 3. WSS URL (模拟)
    random_id = str(uuid.uuid4())[:8]
    options.append(f"wss://localhost:{DEBUG_PORT}/devtools/{random_id}")
    
    # 4. HTTPS URL
    options.append(f"https://localhost:{DEBUG_PORT}")
    
    # 5. 不包含 devtools/browser 的 WebSocket URL
    options.append(f"ws://localhost:{DEBUG_PORT}/debug/{random_id}")
    
    return options

def display_endpoint_options(options):
    """显示端点选项并让用户选择"""
    print("\n=== 请选择连接方式 ===")
    print("1. 标准 WebSocket URL (带有 /devtools/browser/)")
    print(f"   {options[0]}")
    print("2. HTTP URL")
    print(f"   {options[1]}")
    print("3. WSS URL (模拟)")
    print(f"   {options[2]}")
    print("4. HTTPS URL")
    print(f"   {options[3]}")
    print("5. 不包含 devtools/browser 的 WebSocket URL")
    print(f"   {options[4]}")
    
    while True:
        try:
            choice = int(input("\n请输入选项序号 (1-5): "))
            if 1 <= choice <= 5:
                return choice - 1
            else:
                print("无效的选择，请输入 1-5 之间的数字")
        except ValueError:
            print("请输入有效的数字")

def main():
    """主函数"""
    print("启动Chrome远程调试服务...")
    
    # 检查Chrome是否存在
    if not os.path.exists(CHROME_PATH):
        print(f"错误: Chrome可执行文件未找到: {CHROME_PATH}")
        sys.exit(1)
    
    # 启动Chrome
    chrome_process = start_chrome()
    
    # 等待Chrome完全启动
    time.sleep(3)
    
    # 获取WebSocket端点
    websocket_endpoint = get_websocket_endpoint()
    
    if websocket_endpoint:
        # 生成不同的端点选项
        endpoint_options = generate_endpoint_options(websocket_endpoint)
        
        # 显示选项并获取用户选择
        selected_index = display_endpoint_options(endpoint_options)
        selected_endpoint = endpoint_options[selected_index]
        
        print("\n=== 已选择的连接信息 ===")
        print(f"远程浏览器端点: {selected_endpoint}")
        
        print("\n在Koishi配置中使用:")
        print(f"""{{
  "remote": true,
  "endpoint": "{selected_endpoint}"
}}""")
        
        # 如果选择了非标准选项，添加提示
        if selected_index > 0:
            print("\n注意: 你选择了非标准连接方式，这可能不会正常工作。")
            if selected_index in [2, 3]:  # WSS 或 HTTPS
                print("WSS/HTTPS 连接需要配置 SSL 证书，本示例中未实现此功能。")
            elif selected_index == 4:  # 不包含 devtools/browser
                print("此 WebSocket URL 格式可能不被某些版本的 Puppeteer 支持。")
        
        print("\n按Ctrl+C停止服务...")
        
        try:
            # 保持脚本运行
            while chrome_process.poll() is None:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n接收到中断信号，正在关闭...")
    else:
        print("无法获取连接信息，请检查Chrome是否正常启动")
        sys.exit(1)
    
    print("服务已停止")

if __name__ == "__main__":
    main()