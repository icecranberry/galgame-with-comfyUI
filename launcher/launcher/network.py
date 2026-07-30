"""
网络工具函数 —— 获取本机局域网 IP。
优先返回标准私有地址（192.168/10/172.16-31），过滤掉虚拟适配器地址。
"""
import socket


# 非标准私有地址前缀（虚拟适配器/APIPA/环回/基准测试段）
# - 127.x.x.x:   环回
# - 169.254.x.x: APIPA（链路本地，无 DHCP 时自动分配，不是真实 LAN）
# - 198.18-19.x: IANA 基准测试保留段，Hyper-V/WSL/Docker 虚拟适配器常用
_NON_LAN_PREFIXES = (
    (127,),
    (169, 254),
    (198, 18),
    (198, 19),
    (0,),
)


def _is_standard_private_ip(ip: str) -> bool:
    """检查 IP 是否为标准局域网私有地址，排除虚拟适配器地址。"""
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    try:
        octets = [int(p) for p in parts]
    except ValueError:
        return False

    # 排除非标准前缀（环回/APIPA/基准测试段/虚拟适配器）
    for prefix in _NON_LAN_PREFIXES:
        match = True
        for i, val in enumerate(prefix):
            if octets[i] != val:
                match = False
                break
        if match:
            return False

    # 192.168.x.x
    if octets[0] == 192 and octets[1] == 168:
        return True
    # 10.x.x.x
    if octets[0] == 10:
        return True
    # 172.16.x.x - 172.31.x.x
    if octets[0] == 172 and 16 <= octets[1] <= 31:
        return True
    # 100.64.x.x - 100.127.x.x (CGNAT，运营商级 NAT，相当于可路由的局域网段)
    if octets[0] == 100 and 64 <= octets[1] <= 127:
        return True

    return False


def get_local_ip() -> str | None:
    """获取本机局域网 IP 地址。

    策略：
    1. 先用 UDP connect 到 8.8.8.8 获取路由出口 IP，若为标准私有地址直接返回。
    2. 若返回的是虚拟适配器地址（198.18.x 等），则枚举所有网卡 IP，
       取第一个标准私有地址。
    3. 失败返回 None。
    """
    # 策略 1: 路由出口探测
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(("8.8.8.8", 80))
        candidate = s.getsockname()[0]
        s.close()
        if _is_standard_private_ip(candidate):
            return candidate
    except Exception:
        pass

    # 策略 2: 枚举所有网卡，取第一个标准私有地址
    try:
        hostname = socket.gethostname()
        ips = socket.gethostbyname_ex(hostname)[2]
        for ip in ips:
            if _is_standard_private_ip(ip):
                return ip
    except Exception:
        pass

    # 策略 3: 宽松兜底 — 只要不是明显的虚拟/环回地址就返回
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(("8.8.8.8", 80))
        candidate = s.getsockname()[0]
        s.close()
        # 至少排除环回地址
        if not candidate.startswith("127.") and not candidate.startswith("0."):
            return candidate
    except Exception:
        pass

    return None
