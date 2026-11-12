"""Extract and download the infobox portrait before the scraper removes images."""

import base64
import time
from urllib.parse import urlparse
from moegirl_fetch import FetchError, allowed_moegirl_url, fetch_bytes

MAX_IMAGE_BYTES = 6 * 1024 * 1024 - 1024


def allowed_image_url(value, page_url):
    return allowed_moegirl_url(value, page_url)


def find_infobox_image_candidates(scopes, page_url):
    for scope in scopes:
        if scope is None:
            continue
        box = (scope.select_one('.moe-infobox.infobox3')
               or scope.select_one('.moe-infobox, table.infobox3, table.infobox, table.infobox2'))
        if box is None:
            continue
        for img in box.select('img'):
            # Ignore badges/icons; preserve the first portrait (default outfit) in tabbed infoboxes.
            if any(str(img.get(key, '')).isdigit() and int(img[key]) < 80 for key in ('width', 'height')):
                continue
            # Only alternatives of the SAME portrait, never a different costume/tab.
            values = [img.get(attr) for attr in ('data-src', 'src', 'data-original')]
            for attr in ('data-srcset', 'srcset'):
                values.extend(part.strip().split()[0] for part in img.get(attr, '').split(',') if part.strip())
            parent = img.find_parent('a')
            if parent:
                # Wiki File: description pages are not direct images.
                href = parent.get('href', '')
                if urlparse(href).path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and '/file:' not in href.lower():
                    values.append(href)
            urls = []
            for value in values:
                if value:
                    url = allowed_image_url(value, page_url)
                    if url and not urlparse(url).path.lower().endswith(('.svg', '.gif')) and url not in urls:
                        urls.append(url)
            if urls:
                return urls[:5]
    return []


def find_infobox_image(scopes, page_url):
    return next(iter(find_infobox_image_candidates(scopes, page_url)), '')


def fetch_infobox_image(scopes, page_url, session):
    return fetch_infobox_image_result(scopes, page_url, session)['image']


def image_failure(error):
    return {'image': '', 'status': error.code, 'message': str(error), 'retry_after': error.retry_after}


def fetch_infobox_image_result(scopes, page_url, session):
    page_url = allowed_moegirl_url(page_url)
    if not page_url:
        return image_failure(FetchError('invalid_url'))
    deadline = time.monotonic() + 20
    last_error = FetchError('not_found')
    for url in find_infobox_image_candidates(scopes, page_url):
        try:
            data, _ = fetch_bytes(session, url, {'User-Agent': 'Mozilla/5.0', 'Referer': page_url},
                                  deadline, MAX_IMAGE_BYTES)
            mime = ('image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
                    'image/jpeg' if data.startswith(b'\xff\xd8\xff') else
                    'image/webp' if data[:4] == b'RIFF' and data[8:12] == b'WEBP' else '')
            if not mime:
                raise FetchError('invalid_image')
            return {'image': f'data:{mime};base64,{base64.b64encode(data).decode()}',
                    'status': 'ready', 'message': '', 'retry_after': 0}
        except FetchError as error:
            last_error = error
            if error.code == 'rate_limited' or time.monotonic() >= deadline:
                break
    return image_failure(last_error)
