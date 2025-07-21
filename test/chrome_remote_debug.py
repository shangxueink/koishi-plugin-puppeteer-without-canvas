import subprocess
import time
import os
import sys
import signal
import atexit
import webbrowser
import json
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
        print("\n=== Puppeteer连接信息 ===")
        print(f"远程浏览器端点: {websocket_endpoint}")
        print(f"或者使用: http://localhost:{DEBUG_PORT}")
        print("\n在Koishi配置中使用:")
        print(f"""{{
  "remote": true,
  "endpoint": "{websocket_endpoint}"
}}""")
        print("\n按Ctrl+C停止服务...")
    else:
        print("无法获取连接信息，请检查Chrome是否正常启动")
        sys.exit(1)
    
    try:
        # 保持脚本运行
        while chrome_process.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n接收到中断信号，正在关闭...")
    
    print("服务已停止")

if __name__ == "__main__":
    main()