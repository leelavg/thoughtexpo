---
title: "Setup Hugo With Tailwindcss for Netlify"
date: 2020-08-23T11:43:43+05:30
tags: ["hugo", "tailwindcss", "netlify"]
draft: false
---

When I have come across Tailwind CSS for creating a UI for my personal Hugo powered blog I found little information on integrating both with Netlify. I wish to cover three methods (least to most productive) for setting up a hugo blog with tailwindcss and deploying to Netlify in this blog post.

As my experience with blogging and web technologies in general is very less, apart from documentation I referred below resources to get upto speed, a huge thanks for those content creators and I highly recommend them as well.:clap:
- [Hugo Youtube Playlist](https://www.youtube.com/playlist?list=PLLAZ4kZ9dFpOnyRlyS-liKL5ReHDcj4G3)
- Basics of HTML, CSS, JS and TailwindCSS from [Scrimba](https://scrimba.com/)
- GitHub repos of [zwbetz](https://github.com/zwbetz-gh/zwbetz) and [Ian Rodrigues](https://github.com/ianrodrigues/hugowind)

All the methods are tested against a single html page from TailwindCSS [playground](https://github.com/tailwindlabs/tailwindcss-playground) and please follow along for some hands on.

I assume that you have a little knowledge about TailwindCSS, NodeJS and ecosystem around it, hugo blog structure (have a look at this [post](https://zwbetz.com/make-a-hugo-blog-from-scratch/) after hugo's [quick start](https://gohugo.io/getting-started/quick-start/)).

## Method 1: Pulling TailwindCSS from CDN

Method 1 is the easiest out of all three as this involves only pulling a CSS file from a CDN and linking it in your html pages (typically in `baseof.html` of hugo layouts).

As we'll be using a single html page we can refactor it to match recommended hugo project layout as a follow up.

Below repo holds required files to demonstrate all three methods but we'll be cloning one branch at a time corresponding to our method:

`-> git clone --single-branch --branch method1 https://github.com/leelavg/examples.git ~/method1 && cd "$_"`

We are interested in only head section of `index.html` file from this repo where we are linking TailwindCSS from CDN.

`-> sed -n '4,11p' layouts/index.html`
```html {linenos=table,hl_lines=[6],linenostart=4}
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <link rel="icon" type="image/png" sizes="32x32" href="images/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="images/favicon-16x16.png">
  <link href="https://unpkg.com/tailwindcss@^1.0/dist/tailwind.min.css" rel="stylesheet">
  <title>Welcome to Tailwind!</title>
</head>
```

## Method 2: Using PostCSS (Without Hugo Pipes)

TailwindCSS is a [PostCSS](https://github.com/postcss/postcss) plugin which potentially transforms CSS with Javascript, I would describe it in a crude sense as a tool which bisects words into alphabets and hands over to various plugins to act upon resulting in most cases, a CSS file which can be directly consumed by html pages.

There're new entries involved in method 2 which effectively utilizes NodeJS directly.

`-> git clone --single-branch --branch method1 https://github.com/leelavg/examples.git ~/method2 && cd "$_"`

On surface below will be the change in `index.html` when compared to other methods:

`-> sed -n '4,11p' layouts/index.html`
```html {linenos=table,hl_lines=[6],linenostart=4}
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <link rel="icon" type="image/png" sizes="32x32" href="images/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="images/favicon-16x16.png">
  <link href="{{ "css/tailwind.css" | relURL }}" rel="stylesheet" />
  <title>Welcome to Tailwind!</title>
</head>
```

Below is the flow how this site is built in a production context when deployed to Netlify:
- All the packages are installed as stated in *package.json* followed by **hugo v0.74.0** mentioned in *netlify.toml*
- Performs **npm run build** which triggers **postcss** to work on *resources/css/tailwind.css* file emitting formatted CSS file to *static/css/tailwind.css*
- As **npm run build** sets `NODE_ENV` variable to `production`, postcss will invoke purgeCSS too along with tailwindcss, autoprefixer (*postcss.config.js*) to transform and purge unused styles resulting in light weight CSS file
- Finally, **hugo** picks up *static/css/tailwind.css* as part of build process, replaces correct url (in line 9 of above listing) and creates html pages in *public* folder which Netlify serves after finishing build process.

## Method 3: Using PostCSS (With Hugo Pipes)

We'll be using Hugo Pipes feature which implicitly calls postcss-cli on demand during hugo build process eliminating the need for separate build of CSS file and I recommend referring @regisphilibert wonderful post on [hugo pipes](https://regisphilibert.com/blog/2018/07/hugo-pipes-and-asset-processing-pipeline/), in fact his whole [blog](https://regisphilibert.com/) is a good read for learning about hugo.

Lookout for changes in *config.yaml*, *tailwind.config.js* and this method greatly slims our *package.json*.

`-> git clone --single-branch --branch method1 https://github.com/leelavg/examples.git ~/method2 && cd "$_"`

When `NODE_ENV` is set to `production` hugo will minify, fingerprint post-processed CSS (refer below listing) and tailwind (>= v1.4.0) will purge unused styles.

`-> sed -n '4,15p' layouts/index.html`

```html {linenos=table,hl_lines=["6-9"],linenostart=4}
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <link rel="icon" type="image/png" sizes="32x32" href="images/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="images/favicon-16x16.png">
  {{$css := resources.Get "css/tailwind.css" | resources.PostCSS}}
  {{if (eq (getenv "NODE_ENV") "production")}}
  {{$css = $css | minify | fingerprint | resources.PostProcess}}
  {{end}}
  <link rel="stylesheet" type="text/css" href="{{$css.Permalink}}">
  <title>Welcome to Tailwind!</title>
</head>
```

`-> cat tailwind.config.js`

```js {linenos=table,hl_lines=["7-13"],linenostart=1}
module.exports = {
  theme: {
    extend: {},
  },
  variants: {},
  plugins: [],
  purge: {
    content: ["./hugo_stats.json"],
    defaultExtractor: (content) => {
      let els = JSON.parse(content).htmlElements;
      return els.tags.concat(els.classes, els.ids);
    },
  },
}
```

In method 2, purge CSS stores the tags using a custom regex but here we'll be delegating that task to [hugo](https://gohugo.io/getting-started/configuration/#configure-build) by setting `writeStats` to `true` under `build` section of `config.yaml` introduced in `v0.69.0`.

The site will be built in almost similar manner as described in method 2 but `hugo` deals with running `postcss` utilizing necessary tools and builds final CSS file which then be placed in `public` before serving website.

### Miscellaneous:

Hugo combined with Tailwind CSS provides many other features and this post intentionally limits itself at briefly showing the ways to integrate these two and deploying to Netlify. I believe below points will be helpful when you try to build a more feature rich blog on your own:
- When new components are added to CSS file in method 2, make sure you correctly configure [purgeCSS](https://tailwindcss.com/docs/controlling-file-size) for retaining used styles
- Prefer hugo version >= v0.72.0 if you are using method 3, which [fixes](https://github.com/gohugoio/hugo/issues/7161) collection of used tags resulting in correct *hugo_stats.json* for purgecss
- Use [branch](https://docs.netlify.com/site-deploys/overview/#branches-and-deploys) deploy feature available in Netlify if you own a custom domain and this calls for an other interesting blog post
- You can explore this site's [own repo](https://github.com/leelavg/thoughtexpo) in addition to above clones repo branches to get some more info about usage of tailwind components (@apply, @screen) and method 3 in general. `HEAD` on `master` branch is at [`3e1d1e3`](https://github.com/leelavg/thoughtexpo/commit/3e1d1e3f0ad4668191e0b738c34e0eecfbe0a595) at the time of this post publication.

Expressing only thoughts without practice in a sense is futile, so here are the links for final results [Method1](https://method1--thoughtexpo-examples.netlify.app/), [Method2](https://method1--thoughtexpo-examples.netlify.app/) and [Method3](https://method2--thoughtexpo-examples.netlify.app/), these are being served from Netlify as all the repo branches stated above contains a `netlify.toml` and observe `stylesheet` link in `view-source(ctrl-u)` of above html pages.
