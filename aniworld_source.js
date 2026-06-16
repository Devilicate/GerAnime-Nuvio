// ═══════════════════════════════════════════════════
// AniWorld Source Provider
// ═══════════════════════════════════════════════════
// This module is responsible for searching AniWorld, resolving
// TMDB -> AniList mappings, parsing episode host lists, and
// extracting direct stream URLs from supported hosters.

// Nuvio Android plugin environment may not support Node built-ins.
// Use global fetch, URL, and URLSearchParams instead.

class AniWorldClient {
    // Compatibility: static fields assigned after class declaration

    // ═══════════════════════════════════════════════════
    // HTTP Helpers
    // ═══════════════════════════════════════════════════
    async _fetch(url, method = 'GET', data = null, headers = {}) {
        if (typeof fetch === 'function') {
            const requestHeaders = Object.assign({}, AniWorldClient.DEFAULT_HEADERS, headers);
            const options = {
                method,
                headers: requestHeaders,
            };

            if (data != null) {
                options.body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
            }

            const response = await fetch(url, options);
            return await response.text();
        }

        return await this._xhrFetch(url, method, data, headers);
    }

    async _fetchWithResponse(url, method = 'GET', data = null, headers = {}) {
        if (typeof fetch === 'function') {
            const requestHeaders = Object.assign({}, AniWorldClient.DEFAULT_HEADERS, headers);
            const options = {
                method,
                headers: requestHeaders,
            };

            if (data != null) {
                options.body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
            }

            const response = await fetch(url, options);
            const body = await response.text();
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key.toLowerCase()] = value;
            });

            return { body, statusCode: response.status, headers: responseHeaders };
        }

        return await this._xhrFetchWithResponse(url, method, data, headers);
    }

    _xhrFetch(url, method = 'GET', data = null, headers = {}) {
        return new Promise((resolve, reject) => {
            if (typeof XMLHttpRequest === 'undefined') {
                return reject(new Error('No fetch or XMLHttpRequest available'));
            }

            const xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            const headerList = Object.assign({}, AniWorldClient.DEFAULT_HEADERS, headers);
            Object.keys(headerList).forEach((key) => {
                xhr.setRequestHeader(key, headerList[key]);
            });

            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText);
                    } else {
                        reject(new Error(`XHR request failed: ${xhr.status}`));
                    }
                }
            };
            xhr.onerror = () => reject(new Error('XHR network error'));
            const body = data != null ? (typeof data === 'string' ? data : new URLSearchParams(data).toString()) : null;
            xhr.send(body);
        });
    }

    _xhrFetchWithResponse(url, method = 'GET', data = null, headers = {}) {
        return new Promise((resolve, reject) => {
            if (typeof XMLHttpRequest === 'undefined') {
                return reject(new Error('No fetch or XMLHttpRequest available'));
            }

            const xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            const headerList = Object.assign({}, AniWorldClient.DEFAULT_HEADERS, headers);
            Object.keys(headerList).forEach((key) => {
                xhr.setRequestHeader(key, headerList[key]);
            });

            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) {
                    const responseHeaders = {};
                    xhr.getAllResponseHeaders().trim().split(/\r?\n/).forEach((line) => {
                        const parts = line.split(': ');
                        if (parts.length === 2) {
                            responseHeaders[parts[0].toLowerCase()] = parts[1];
                        }
                    });
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve({ body: xhr.responseText, statusCode: xhr.status, headers: responseHeaders });
                    } else {
                        reject(new Error(`XHR request failed: ${xhr.status}`));
                    }
                }
            };
            xhr.onerror = () => reject(new Error('XHR network error'));
            const body = data != null ? (typeof data === 'string' ? data : new URLSearchParams(data).toString()) : null;
            xhr.send(body);
        });
    }

    // ═══════════════════════════════════════════════════
    // AniWorld Search & Metadata Helpers
    // ═══════════════════════════════════════════════════
    async search(keyword, limit = 20) {
        const searchUrl = new URL(AniWorldClient.SEARCH_PATH, AniWorldClient.BASE_URL).toString();
        const payload = new URLSearchParams({ keyword }).toString();
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: new URL(`/search?q=${encodeURIComponent(keyword)}`, AniWorldClient.BASE_URL).toString(),
        };
        const body = await this._fetch(searchUrl, 'POST', payload, headers);
        const results = body ? JSON.parse(body) : [];
        return results.slice(0, limit);
    }

    async searchFromMetadata(metadataTitle, limit = 20) {
        const keyword = this.normalizeTitleForSearch(metadataTitle);
        return this.search(keyword, limit);
    }

    async searchFromTmdbId(tmdbId, type = 'tv', season = 1, episode = 1, fallbackTitle = null, limit = 20) {
        const title = await this.getSearchTitleFromTmdb(tmdbId, type, season, episode, fallbackTitle);
        if (!title) return [];
        return this.search(this.normalizeTitleForSearch(title), limit);
    }

    async getSearchTitleFromTmdb(tmdbId, type = 'tv', season = 1, episode = 1, fallbackTitle = null) {
        const anilistId = await this.getAnilistId(tmdbId, type);
        if (anilistId) {
            const resolved = await this.resolveAnilistEpisode(anilistId, season, episode, type);
            if (resolved.title) {
                return resolved.title;
            }
        }
        return fallbackTitle;
    }

    normalizeTitleForSearch(title) {
        let normalized = title.trim();
        normalized = normalized.replace(/\b[Ss]taffel\s*\d+\b/g, '');
        normalized = normalized.replace(/\b[Ss]eason\s*\d+\b/g, '');
        normalized = normalized.replace(/\b[Ee]pisode\s*\d+\b/g, '');
        normalized = normalized.replace(/\b[Ee]p\s*\d+\b/g, '');
        normalized = normalized.replace(/\bS\d+E\d+\b/g, '');
        normalized = normalized.replace(/[-–—].*$/, '');
        normalized = normalized.replace(/\s+/g, ' ');
        return normalized.trim();
    }

    async getTmdbTitle(tmdbId, type = 'tv') {
        try {
            // 1) Try AniList mapping first (no API key required)
            try {
                const anilistId = await this.getAnilistId(tmdbId, type);
                if (anilistId) {
                    const meta = await this.getAnilistMeta(anilistId);
                    const title = meta && meta.title ? (meta.title.romaji || meta.title.english || meta.title.native || null) : null;
                    if (title) return title;
                }
            } catch (e) {
                // ignore and continue
            }

            // 2) Try ARM mapping response for a fallback title
            try {
                const armUrl = `https://arm.haglund.dev/api/v2/themoviedb?id=${encodeURIComponent(tmdbId)}`;
                const armBody = await this._fetch(armUrl, 'GET', null, { Accept: 'application/json' });
                const armData = JSON.parse(armBody || '[]');
                if (Array.isArray(armData) && armData.length > 0) {
                    const first = armData[0];
                    if (first && first.title) return first.title;
                    if (first && first.name) return first.name;
                }
            } catch (e) {
                // ignore and continue
            }

            // 3) Last resort: scrape TMDB public page (no API key)
            const path = type === 'movie' ? 'movie' : 'tv';
            const url = `https://www.themoviedb.org/${path}/${encodeURIComponent(tmdbId)}`;
            const html = await this._fetch(url, 'GET', null, { Referer: AniWorldClient.BASE_URL });
            // Prefer og:title
            let m = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
            if (m) return m[1].trim();
            m = html.match(/<title>(.*?)<\/title>/i);
            if (m) return m[1].replace(/\s*-\s*The Movie Database.*$/i, '').trim();
        } catch (error) {
            // fall through
        }
        return null;
    }

    async _searchWithFallbacks(tmdbId, type = 'tv', season = 1, episode = 1, fallbackTitle = null, limit = 10) {
        const tried = new Set();

        const trySearch = async (title) => {
            if (!title) return [];
            const norm = this.normalizeTitleForSearch(title);
            if (tried.has(norm)) return [];
            tried.add(norm);
            const res = await this.search(norm, limit);
            return res || [];
        };

        // 1) AniList-resolved title (may already return series title for related movies)
        const anilistId = await this.getAnilistId(tmdbId, type);
        if (anilistId) {
            const resolved = await this.resolveAnilistEpisode(anilistId, season, episode, type);
            if (resolved && resolved.title) {
                const r = await trySearch(resolved.title);
                if (r.length) return {results: r, resolved};
            }
        }

        // 2) TMDB title (requires TMDB_API_KEY in env)
        const tmdbTitle = await this.getTmdbTitle(tmdbId, type);
        if (tmdbTitle) {
            const r = await trySearch(tmdbTitle);
            if (r.length) return {results: r, resolved: { title: tmdbTitle, ep: episode, seasonLabel: `${season}` }};
        }

        // 3) Fallback title provided by caller
        if (fallbackTitle) {
            const r = await trySearch(fallbackTitle);
            if (r.length) return {results: r, resolved: { title: fallbackTitle, ep: episode, seasonLabel: `${season}` }};
        }

        // 4) As last resort, try a looser normalization of the fallbackTitle or tmdbTitle
        const loosen = (t) => (t || '').replace(/[:\"'()\[\]]+/g, '').replace(/\s+/g, ' ').trim();
        if (tmdbTitle) {
            const r = await trySearch(loosen(tmdbTitle));
            if (r.length) return {results: r, resolved: { title: tmdbTitle, ep: episode, seasonLabel: `${season}` }};
        }
        if (fallbackTitle) {
            const r = await trySearch(loosen(fallbackTitle));
            if (r.length) return {results: r, resolved: { title: fallbackTitle, ep: episode, seasonLabel: `${season}` }};
        }

        return {results: [], resolved: { title: null, ep: episode, seasonLabel: `${season}` }};
    }

    // ═══════════════════════════════════════════════════
    // Fuzzy Title Similarity Helpers
    // ═══════════════════════════════════════════════════
    async getSimilarity(text1, text2) {
        if (!text1 || !text2) return 0;

        const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const s1 = normalize(text1);
        const s2 = normalize(text2);
        if (s1 === s2) return 1.0;
        if (s1.length < 2 || s2.length < 2) return 0;

        const bigrams = (str) => {
            const set = new Set();
            for (let i = 0; i < str.length - 1; i += 1) {
                set.add(str.substring(i, i + 2));
            }
            return set;
        };

        const b1 = bigrams(s1);
        const b2 = bigrams(s2);
        let intersection = 0;
        for (const gram of b1) {
            if (b2.has(gram)) intersection += 1;
        }

        return (2 * intersection) / (b1.size + b2.size);
    }

    pickBestMatch(results, targetTitle) {
        if (!Array.isArray(results) || results.length === 0) return null;
        if (!targetTitle) return results[0];

        let best = null;
        let bestScore = 0;
        for (const result of results) {
            const score = this.getSimilarity(result.title || result.name || '', targetTitle);
            if (score > bestScore) {
                bestScore = score;
                best = result;
            }
        }
        return bestScore > 0.4 ? best : results[0];
    }

    // ═══════════════════════════════════════════════════
    // TMDB → AniList ID Mapping
    // ═══════════════════════════════════════════════════
    async getAnilistId(tmdbId, type = 'tv') {
        try {
            const url = `https://arm.haglund.dev/api/v2/themoviedb?id=${encodeURIComponent(tmdbId)}`;
            const body = await this._fetch(url, 'GET', null, { Accept: 'application/json' });
            const data = JSON.parse(body || '[]');
            if (Array.isArray(data) && data.length > 0 && data[0].anilist) {
                return data[0].anilist;
            }
        } catch (error) {
            console.error('getAnilistId error:', error);
        }
        return null;
    }

    async getAnilistMeta(anilistId) {
        const query = `
            query ($id: Int) {
                Media(id: $id) {
                    id
                    format
                    episodes
                    title { romaji english native }
                    relations {
                        edges {
                            relationType
                            node {
                                id
                                format
                                episodes
                                type
                                title { romaji english native }
                            }
                        }
                    }
                }
            }
        `;
        try {
            const body = JSON.stringify({ query, variables: { id: parseInt(anilistId, 10) } });
            const response = await this._fetch('https://graphql.anilist.co', 'POST', body, {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            });
            const json = JSON.parse(response || '{}');
            return json.data && json.data.Media ? json.data.Media : null;
        } catch (error) {
            console.error('getAnilistMeta error:', error);
            return null;
        }
    }

    _findSeriesRelationTitle(meta) {
        if (!meta || !meta.relations || !Array.isArray(meta.relations.edges)) return null;

        const preferredTypes = [
            'PARENT',
            'PREQUEL',
            'SEQUEL',
            'ADAPTATION',
            'SIDE_STORY',
            'SPIN_OFF',
            'ALTERNATIVE',
            'OTHER',
            'RELATED',
        ];

        const candidates = meta.relations.edges
            .map((edge) => {
                const node = edge.node || {};
                const nodeTitle = node.title || {};
                return {
                    title: node.title ? (node.title.romaji || node.title.english || node.title.native || null) : null,
                    relationType: edge.relationType || 'OTHER',
                    format: node.format || null,
                    type: node.type || null,
                };
            })
            .filter((item) => item.title && item.type === 'ANIME' && ['TV', 'TV_SHORT', 'ONA', 'OVA'].includes(item.format));

        if (!candidates.length) return null;

        candidates.sort((a, b) => {
            const aIndex = preferredTypes.indexOf(a.relationType.toUpperCase());
            const bIndex = preferredTypes.indexOf(b.relationType.toUpperCase());
            return (aIndex === -1 ? preferredTypes.length : aIndex) - (bIndex === -1 ? preferredTypes.length : bIndex);
        });

        return candidates[0] && candidates[0].title ? candidates[0].title : null;
    }

    async resolveAnilistEpisode(anilistId, targetSeason, targetEp, type = 'tv') {
        const meta = await this.getAnilistMeta(anilistId);
        if (!meta) return { title: null, ep: targetEp, seasonLabel: `${targetSeason}` };

        const title = meta.title ? (meta.title.romaji || meta.title.english || meta.title.native || null) : null;
        if (type === 'movie') {
            const seriesTitle = this._findSeriesRelationTitle(meta);
            return {
                title: seriesTitle || title,
                ep: 1,
                seasonLabel: seriesTitle ? 'filme' : `${targetSeason}`,
            };
        }

        return { title, ep: targetEp, seasonLabel: `${targetSeason}` };
    }

    // ═══════════════════════════════════════════════════
    // AniWorld Episode Host Parsing
    // ═══════════════════════════════════════════════════
    async getEpisodeHosts(episodeUrl) {
        const html = await this._fetch(episodeUrl, 'GET', null, { Referer: AniWorldClient.BASE_URL });
        return this._parseEpisodeHosts(html);
    }

    _parseEpisodeHosts(html) {
        const liPattern = /<li\b([^>]*)>.*?<\/li>/gis;
        const hosts = [];
        let match;

        while ((match = liPattern.exec(html)) !== null) {
            const attrs = match[1];
            const target = this._extractAttribute(attrs, 'data-link-target');
            const lang = this._extractAttribute(attrs, 'data-lang-key');
            if (!target || !lang) continue;

            const block = match[0];
            const label = this._extractLabel(block);
            const mapped = this._mapLanguageKey(lang);
            const detected = this._detectLanguageFromLabel(label);
            hosts.push({
                lang_key: lang,
                language: detected || mapped,
                hoster: this._extractHoster(block),
                brand: this._extractIcon(block),
                label,
                link: new URL(target, AniWorldClient.BASE_URL).toString(),
            });
        }

        return hosts;
    }

    _extractAttribute(html, name) {
        const match = html.match(new RegExp(`${name}=['\"]([^'\"]+)['\"]`, 'i'));
        return match ? match[1].trim() : '';
    }

    _extractHoster(html) {
        let match = html.match(/title=['\"]Hoster\s+([^'\"]+)['\"]/i);
        if (match) return match[1].trim();
        match = html.match(/<i[^>]*class=['\"][^'\"]*icon\s+([^'\"]+)[^'\"]*['\"]/i);
        return match ? match[1].trim() : '';
    }

    _extractLabel(html) {
        const match = html.match(/<h4>([^<]+)<\/h4>/i);
        return match ? match[1].trim() : '';
    }

    _extractIcon(html) {
        const match = html.match(/<i[^>]*class=['\"][^'\"]*icon\s+([^'\"]+)[^'\"]*['\"]/i);
        return match ? match[1].trim() : '';
    }

    _detectLanguageFromLabel(label) {
        if (!label) return null;
        const l = label.toLowerCase();
        if (l.includes('deutsch') || l.includes('german') || l.includes('deu')) return 'german';
        if (l.includes('sub') && (l.includes('de') || l.includes('ger') || l.includes('deutsch'))) return 'german-sub';
        if (l.includes('original') || l.includes('originalton') || l.includes('jap')) return 'original';
        if (l.includes('engl') || l.includes('english') || l.includes('eng')) return 'english';
        if (l.includes('franz') || l.includes('french') || l.includes('fr')) return 'french';
        return null;
    }

    _mapLanguageKey(langKey) {
        return {
            '1': 'german',
            '2': 'original',
            '3': 'german-sub',
            '4': 'english',
            '5': 'french',
        }[langKey] || 'unknown';
    }

    // ═══════════════════════════════════════════════════
    // Redirect Resolution
    // ═══════════════════════════════════════════════════
    async resolveRedirect(redirectUrl) {
        const response = await this._fetchWithResponse(redirectUrl, 'GET', null, { Referer: AniWorldClient.BASE_URL });
        const { statusCode, headers, body } = response;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
            return new URL(headers.location, redirectUrl).toString();
        }

        // Try common JS-based redirects
        const jsPatterns = [
            /window\.location\.href\s*=\s*['\"]([^'\"]+)['\"]/i,
            /location\.href\s*=\s*['\"]([^'\"]+)['\"]/i,
            /location\.replace\(\s*['\"]([^'\"]+)['\"]\s*\)/i,
            /location\.assign\(\s*['\"]([^'\"]+)['\"]\s*\)/i,
        ];
        for (const pat of jsPatterns) {
            const m = body.match(pat);
            if (m && m[1]) return new URL(m[1].trim(), redirectUrl).toString();
        }

        // Meta refresh
        const metaMatch = body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?[^"'>]*url=([^"'>\s]+)["']?/i);
        if (metaMatch && metaMatch[1]) return new URL(metaMatch[1].trim(), redirectUrl).toString();

        // Sometimes the page contains a direct anchor we can follow
        const aMatch = body.match(/<a[^>]+href=['\"]([^'\"]+)['\"][^>]*>/i);
        if (aMatch && aMatch[1]) return new URL(aMatch[1].trim(), redirectUrl).toString();

        throw new Error(`Cannot resolve redirect target from ${redirectUrl}`);
    }

    // ═══════════════════════════════════════════════════
    // Host Page Extraction
    // ═══════════════════════════════════════════════════
    async getStreamUrl(hostPageUrl) {
        const parsed = new URL(hostPageUrl);
        const hostname = parsed.hostname.toLowerCase();

        if (hostname.includes('voe.') || hostname.includes('juliewomanwish.com')) {
            return this._extractVoeStreamUrl(hostPageUrl);
        }
        if (hostname.includes('vidoza.')) {
            return this._extractVidozaStreamUrl(hostPageUrl);
        }
        throw new Error(`Host extraction not implemented for: ${hostname}`);
    }

    // ═══════════════════════════════════════════════════
    // VOE Stream Decoding
    // ═══════════════════════════════════════════════════
    async _extractVoeStreamUrl(pageUrl) {
        let html = await this._fetch(pageUrl, 'GET', null, { Referer: AniWorldClient.BASE_URL });
        const redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)'/i);
        if (redirectMatch) {
            pageUrl = redirectMatch[1];
            html = await this._fetch(pageUrl, 'GET', null, { Referer: pageUrl });
        }

        const scriptMatch = html.match(/<script[^>]+type=['\"]application\/json['\"][^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
            const encoded = scriptMatch[1].trim();
            const decoded = this._decodeVoePayload(encoded);
            const data = JSON.parse(decoded);
            if (data.source) return data.source;
        }

        throw new Error(`Cannot extract VOE stream URL from ${pageUrl}`);
    }

    _decodeVoePayload(encoded) {
        let payload = encoded;
        if (payload.length >= 4) {
            payload = payload.slice(2, -2);
        }

        payload = this._rot13(payload);
        for (let i = 0; i < AniWorldClient.VOE_JUNK_PARTS.length; i += 1) {
            payload = payload.split(AniWorldClient.VOE_JUNK_PARTS[i]).join('_');
        }
        payload = payload.replace(/_/g, '');

        const decodedStr = this._base64DecodeUtf8(payload);
        const shifted = decodedStr.split('').map((ch) => String.fromCharCode(ch.charCodeAt(0) - 3)).join('');
        const reversed = shifted.split('').reverse().join('');
        return this._base64DecodeUtf8(reversed);
    }

    // ═══════════════════════════════════════════════════
    // Vidoza Stream Extraction
    // ═══════════════════════════════════════════════════
    async _extractVidozaStreamUrl(pageUrl) {
        const html = await this._fetch(pageUrl, 'GET', null, { Referer: AniWorldClient.BASE_URL });
        const match = html.match(/<video[^>]+id=['\"]player['\"][^>]*>[\s\S]*?<source[^>]+src=['\"]([^'\"]+)['\"]/i);
        if (match) return match[1];
        throw new Error(`Cannot extract Vidoza stream URL from ${pageUrl}`);
    }

    _rot13(data) {
        return data.split('').map((ch) => {
            if (ch >= 'A' && ch <= 'Z') return String.fromCharCode(((ch.charCodeAt(0) - 65 + 13) % 26) + 65);
            if (ch >= 'a' && ch <= 'z') return String.fromCharCode(((ch.charCodeAt(0) - 97 + 13) % 26) + 97);
            return ch;
        }).join('');
    }

    _base64DecodeUtf8(base64) {
        const binary = typeof atob === 'function' ? atob(base64) : null;
        if (binary !== null) {
            let percentEncoded = '';
            for (let i = 0; i < binary.length; i += 1) {
                percentEncoded += '%' + ('00' + binary.charCodeAt(i).toString(16)).slice(-2);
            }
            return decodeURIComponent(percentEncoded);
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(base64, 'base64').toString('utf8');
        }
        throw new Error('Base64 decode not supported in this environment');
    }

    // ═══════════════════════════════════════════════════
    // Preferred Stream Selection
    // ═══════════════════════════════════════════════════
    async getPreferredStream(episodeUrl, preferredLanguages = ['german', 'german-sub', 'english', 'original']) {
        const hosts = await this.getEpisodeHosts(episodeUrl);
        if (!hosts.length) throw new Error(`No hosters found on episode page: ${episodeUrl}`);

        for (const language of preferredLanguages) {
            for (const host of hosts) {
                if (host.language === language) {
                    const finalUrl = await this.resolveRedirect(host.link);
                    return this.getStreamUrl(finalUrl);
                }
            }
        }

        const first = hosts[0];
        const finalUrl = await this.resolveRedirect(first.link);
        return this.getStreamUrl(finalUrl);
    }

    async getStreamFromTmdb(tmdbId, type = 'tv', season = 1, episode = 1, fallbackTitle = null, preferredLanguages = ['german', 'german-sub', 'english', 'original']) {
        const { results, resolved } = await this._searchWithFallbacks(tmdbId, type, season, episode, fallbackTitle, 10);
        if (!results || results.length === 0) {
            throw new Error(`No AniWorld search results found for TMDB ID ${tmdbId}`);
        }

        const targetTitle = (resolved && resolved.title) ? resolved.title : (await this.getSearchTitleFromTmdb(tmdbId, type, season, episode, fallbackTitle)) || fallbackTitle || '';
        const best = this.pickBestMatch(results, targetTitle);
        if (!best || !best.link) {
            throw new Error('Could not determine a best AniWorld search result');
        }

        const seasonSegment = (resolved && resolved.seasonLabel) ? resolved.seasonLabel : `${season}`;
        const episodeNumber = (resolved && resolved.ep) ? resolved.ep : episode;
        const episodeUrl = this._buildEpisodeUrl(best.link, seasonSegment, episodeNumber);
        return this.getPreferredStream(episodeUrl, preferredLanguages);
    }

    _buildEpisodeUrl(bestLink, seasonSegment, episodeNumber) {
        let link = bestLink.replace(/\/+$/, '');
        const episodePattern = /\/staffel-[^\/]+\/episode-[^\/]+$/i;
        if (episodePattern.test(link)) {
            link = link.replace(episodePattern, '');
        }
        return new URL(`${link}/staffel-${seasonSegment}/episode-${episodeNumber}`, AniWorldClient.BASE_URL).toString();
    }
}

AniWorldClient.BASE_URL = 'https://aniworld.to';
AniWorldClient.SEARCH_PATH = '/ajax/search';
AniWorldClient.DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36, (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
AniWorldClient.VOE_JUNK_PARTS = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];

async function getStreams(id, type, season, episode) {
    const client = new AniWorldClient();
    const streamUrl = await client.getStreamFromTmdb(id, type, season, episode, null);
    return [
        {
            name: 'AniWorld',
            title: `AniWorld - ${type} ${season}x${episode}`,
            url: streamUrl,
            quality: 'auto',
            headers: { Referer: AniWorldClient.BASE_URL },
        },
    ];
}

// ═══════════════════════════════════════════════════
// Self-test / Demo
// ═══════════════════════════════════════════════════
if (typeof require !== 'undefined' && require.main === module) {
    (async () => {
        const client = new AniWorldClient();
        const metadataTitle = 'Serial Experiments Lain Staffel 1 Episode 1';
        const tmdbId = 1087;
        const type = 'tv';
        const season = 1;
        const episode = 1;

        console.log(`Searching AniWorld for metadata title: ${metadataTitle}`);
        const searchResults = await client.searchFromMetadata(metadataTitle);
        for (const result of searchResults.slice(0, 5)) {
            console.log(`- ${result.title} -> ${result.link}`);
        }

        console.log(`\nSearching AniWorld using TMDB->AniList mapping for TMDB ID ${tmdbId}`);
        const tmdbResults = await client.searchFromTmdbId(tmdbId, type, season, episode, metadataTitle);
        for (const result of tmdbResults.slice(0, 5)) {
            console.log(`- ${result.title} -> ${result.link}`);
        }

        console.log(`\nResolving stream directly from TMDB metadata...`);
        try {
            const streamUrl = await client.getStreamFromTmdb(tmdbId, type, season, episode, metadataTitle);
            console.log(`Direct AniWorld stream URL: ${streamUrl}`);
        } catch (error) {
            console.error('Stream fetch failed:', error.message || error);
        }

        const normalized = client.normalizeTitleForSearch(metadataTitle);
        console.log(`\nNormalized search term: ${normalized}`);
        console.log('\nUse getStreamFromTmdb(tmdbId, type, season, episode, fallbackTitle) to fetch the direct stream URL.');
    })().catch((error) => {
        console.error(error);
        if (typeof process !== 'undefined' && process && typeof process.exit === 'function') {
            process.exit(1);
        }
    });
}

const provider = getStreams;
provider.name = 'AniWorld';
provider.getStreams = getStreams;
provider.default = getStreams;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = provider;
} else {
    var root = (typeof globalThis !== 'undefined' && globalThis)
        || (typeof self !== 'undefined' && self)
        || (typeof window !== 'undefined' && window)
        || (typeof global !== 'undefined' && global);
    if (root) {
        root.AniWorldProvider = provider;
    }
}
