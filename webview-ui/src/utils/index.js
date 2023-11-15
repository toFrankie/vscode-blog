import dayjs from 'dayjs'
import matter from 'gray-matter'

export const cdnURL = ({user, repo, branch, file}) =>
  `https://cdn.jsdelivr.net/gh/${user}/${repo}${branch ? '@' + branch : ''}/${file}`

export async function to(promise, errorExt) {
  try {
    const data = await promise
    const res = [null, data]
    return res
  } catch (err) {
    if (errorExt) {
      Object.assign(err, errorExt)
    }
    const res = [err, undefined]
    return res
  }
}

export function getVscode() {
  // 兼容 HMR
  if (window.__vscode__) {
    return window.__vscode__
  }

  const vscode = acquireVsCodeApi()
  window.__vscode__ = vscode
  return vscode
}

export function generateMarkdown(issue) {
  return matter.stringify(issue.body, {
    title: issue.title,
    number: `#${issue.number}`,
    link: issue.html_url || issue.url,
    created_at: dayjs(issue.created_at || issue.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    updated_at: dayjs(issue.updated_at || issue.updatedAt).format('YYYY-MM-DD HH:mm:ss'),
    labels: issue.labels?.map(({name}) => name) || [],
  })
}
