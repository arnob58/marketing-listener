import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import { IngestService } from '../../src/background/ingest';
import { RESERVED } from '../../src/adapters/facebook/selectors';
import { MON, createWorld } from '../helpers/world';

const URL_ = 'https://www.facebook.com/groups/123456/';
const adapter = getAdapterForUrl(URL_)!;

function article(authorHref: string[], permalink: string): string {
  const links = authorHref.map((h, i) => `<h3><a href="${h}">Name ${i}</a></h3>`).join('');
  return `<div role="article">${links}<a href="${permalink}">2h</a><div data-ad-rendering-role="story_message">a post body</div></div>`;
}

function extract(html: string) {
  const doc = new Window({ url: URL_ }).document;
  doc.body.innerHTML = html;
  return collectPosts(adapter, doc as unknown as Document, { url: URL_, now: MON });
}

describe('Facebook author guard', () => {
  it.each(['/groups/123456/', '/photo/?fbid=99', '/watch/', '/reel/777/', '/marketplace/', '/events/55/', '/stories/1/'])(
    'never stores %s as an author: the post is kept with author unresolved',
    (href) => {
      const [post] = extract(article([href], '/groups/123456/posts/987/'));
      expect(post).toBeDefined();
      expect(RESERVED.has(post.authorHandle)).toBe(false);
      expect(post.authorHandle).toBe('unknown');
      expect(post.resolved.author).toBe(false);
      expect(post.resolved.url).toBe(true);
    },
  );

  it('skips a group-name link and takes the first link that names a person', () => {
    const [post] = extract(article(['/groups/123456/', '/Some.Person'], '/groups/123456/posts/987/'));
    expect(post.authorHandle).toBe('some.person');
    expect(post.resolved.author).toBe(true);
  });

  it('still reads a group member profile link and profile.php ids', () => {
    expect(extract(article(['/groups/123456/user/4242/'], '/groups/123456/posts/1/'))[0].authorHandle).toBe('id4242');
    expect(extract(article(['/profile.php?id=777'], '/groups/123456/posts/2/'))[0].authorHandle).toBe('id777');
  });

  it('no stored post or account carries a reserved word as its author', async () => {
    const posts = [
      ...extract(article(['/groups/123456/'], '/groups/123456/posts/10/')),
      ...extract(article(['/photo/?fbid=5'], '/groups/123456/posts/11/')),
      ...extract(article(['/watch/'], '/groups/123456/posts/12/')),
      ...extract(article(['/groups/123456/', '/real.author'], '/groups/123456/posts/13/')),
    ];
    const w = createWorld();
    const ingest = new IngestService(w.repo, { notify: () => {} });
    for (const p of posts) await ingest.ingestPost(p, MON);

    const stored = await w.repo.allPosts();
    expect(stored).toHaveLength(4);
    expect(stored.every((p) => !RESERVED.has(p.authorHandle))).toBe(true);
    // Unresolved authors are placeholders and are not tracked as accounts.
    expect((await w.repo.allAccounts()).map((a) => a.handle)).toEqual(['real.author']);
    expect((await w.repo.allHealth())[0].author).toBe(1);
  });
});
