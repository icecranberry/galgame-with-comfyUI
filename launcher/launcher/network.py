"""网络工具函数 —— 获取手机可访问的本机局域网 IPv4 地址。"""

import socket


# 这些接口通常不与手机处于同一个二层局域网，不能用于生成手机访问地址。
_VIRTUAL_INTERFACE_KEYWORDS = (
    "tun",
    "tap",
    "wintun",
    "vpn",
    "wireguard",
    "tailscale",
    "zerotier",
    "clash",
    "mihomo",
    "sing-box",
    "veth",
    "vethernet",
    "hyper-v",
    "wsl",
    "docker",
    "vmware",
    "virtualbox",
    "loopback",
)


def _private_ip_priority(ip: str) -> int | None:
    """返回适合局域网分享的地址优先级；不是可用私有地址则返回 None。"""
    parts = ip.split(".")
    if len(parts) != 4:
        return None
    try:
        octets = [int(part) for part in parts]
    except ValueError:
        return None
    if any(part < 0 or part > 255 for part in octets):
        return None

    # 家用路由器最常见的网段优先，可避免 172.x TUN 抢走 192.168.x LAN。
    if octets[0] == 192 and octets[1] == 168:
        return 0
    if octets[0] == 10:
        return 1
    if octets[0] == 172 and 16 <= octets[1] <= 31:
        return 2
    # 部分运营商/随身热点会给终端分配 CGNAT 地址。
    if octets[0] == 100 and 64 <= octets[1] <= 127:
        return 3
    return None


def _is_standard_private_ip(ip: str) -> bool:
    """兼容旧调用：判断地址能否作为局域网候选。"""
    return _private_ip_priority(ip) is not None


def _is_virtual_interface(name: str) -> bool:
    normalized = name.lower().replace(" ", "")
    return any(keyword.replace(" ", "") in normalized for keyword in _VIRTUAL_INTERFACE_KEYWORDS)


def _choose_lan_ip(candidates: list[tuple[str, str, bool]]) -> str | None:
    """从 ``(接口名, IPv4, 是否启用)`` 中选出最适合手机访问的地址。"""
    usable: list[tuple[int, int, str]] = []
    for order, (interface_name, ip, is_up) in enumerate(candidates):
        priority = _private_ip_priority(ip)
        if not is_up or priority is None or _is_virtual_interface(interface_name):
            continue
        usable.append((priority, order, ip))

    if not usable:
        return None
    return min(usable)[2]


def _interface_candidates() -> list[tuple[str, str, bool]] | None:
    """用 psutil 枚举带接口名称的 IPv4；不可用时返回 None。"""
    try:
        import psutil

        addresses = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        candidates: list[tuple[str, str, bool]] = []
        for interface_name, interface_addresses in addresses.items():
            is_up = stats.get(interface_name).isup if interface_name in stats else True
            for address in interface_addresses:
                if address.family == socket.AF_INET:
                    candidates.append((interface_name, address.address, is_up))
        return candidates
    except (ImportError, OSError, RuntimeError):
        return None


def get_local_ip() -> str | None:
    """获取手机可访问的物理局域网地址，忽略 TUN/VPN 等虚拟接口。"""
    candidates = _interface_candidates()
    if candidates is not None:
        # psutil 枚举成功但没有物理 LAN 时，不拿虚拟地址冒充手机访问地址。
        return _choose_lan_ip(candidates)

    # 极简开发环境没有 psutil 时的兼容兜底。这里不再探测默认路由，
    # 因为 TUN 模式下默认路由恰好就是错误的虚拟接口。
    try:
        hostname = socket.gethostname()
        ips = socket.gethostbyname_ex(hostname)[2]
        fallback = [
            (_private_ip_priority(ip), order, ip)
            for order, ip in enumerate(ips)
            if _private_ip_priority(ip) is not None
        ]
        return min(fallback)[2] if fallback else None
    except OSError:
        return None
