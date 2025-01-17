/* eslint-disable import/no-unresolved */
/* eslint-disable no-restricted-globals */
/* eslint-disable react-hooks/exhaustive-deps */

import {useEffect} from 'react'
import {observer, useLocalObservable} from 'mobx-react-lite'
import {ConfigProvider, message} from 'antd'
import {WebviewRPC} from 'vscode-webview-rpc'
import {cloneDeep} from 'licia'
import {Buffer} from 'buffer'
import dayjs from 'dayjs'
import 'bytemd/dist/index.min.css'
import 'github-markdown-css'

import './App.css'
import './github.custom.css'
import './reset.css'

import Editor from './components/editor'
import ActionBox from './components/action-box'
import LabelManager from './components/label-manager'
import List from './components/list'
import {getMilestones} from './service'
import {compareIssue, generateMarkdown, getVscode} from './utils'

window.Buffer = window.Buffer || Buffer

let RPC

const vscode = getVscode()

const showError = res => {
  message.error(res)
  return Promise.resolve()
}

const showSuccess = res => {
  message.success(res)
  return Promise.resolve()
}

const theme = {
  token: {
    colorPrimary: '#00b96b',
    colorInfo: '#00b96b',
    borderRadius: 6,
  },
}

const SUBMIT_TYPE = {
  CREATE: 'create',
  UPDATE: 'update',
}

const App = observer(() => {
  const store = useLocalObservable(() => ({
    labels: [],
    milestones: [],
    issues: [],
    filterTitle: '',
    filterLabels: [],
    filterMilestones: [],
    current: {},
    originalCurrent: {},
    totalCount: 1,
    currentPage: 1,
    listVisible: false,
    labelsVisible: false,
    loading: false,
    setLoading: loading => {
      store.loading = loading
    },
    setFilterTitle: title => {
      store.filterTitle = title
    },
    setFilterLabels: labels => {
      store.filterLabels = labels
    },
    getLabels: async () => {
      const labels = await RPC.emit('getLabels', [])
      store.labels = labels || []
    },
    createLabel: async e => {
      await RPC.emit('createLabel', [e])
      store.getLabels()
    },
    deleteLabel: async e => {
      await RPC.emit('deleteLabel', [e])
      store.getLabels()
    },
    updateLabel: async (a, b) => {
      await RPC.emit('updateLabel', [a, b])
      store.getLabels()
    },
    getMilestones: async () => {
      const milestones = await getMilestones()
      store.milestones = milestones
    },
    getIssueTotalCount: async () => {
      let count
      if (store.filterLabels.length > 0) {
        count = await RPC.emit('getFilterCount', [
          store.filterLabels.map(label => label.name).join(','),
        ])
      } else {
        count = await RPC.emit('getTotalCount')
      }
      store.totalCount = count
    },
    getIssues: async () => {
      store.setLoading(true)
      if (store.filterLabels.length < 2 && !store.filterTitle) {
        store.getIssueTotalCount()
        const issues = await RPC.emit('getIssues', [
          store.currentPage,
          store.filterLabels.map(label => label.name).join(','),
        ])
        store.issues = issues || []
      } else {
        const {issueCount, issues} = await RPC.emit('getFilterIssues', [
          store.filterTitle,
          store.filterLabels.map(label => label.name).join(','),
          store.currentPage,
        ])

        store.totalCount = issueCount
        store.issues = issues
      }
      store.setLoading(false)
    },
    resetCurrentPage: () => {
      store.currentPage = 1
    },
    setCurrentPage(page) {
      store.currentPage = page
      store.getIssues()
    },
    updateTitle: title => {
      store.current.title = title
    },
    setListVisible: visible => {
      store.listVisible = visible
      store.getIssues()
    },
    setLabelVisible: visible => {
      store.labelsVisible = visible
    },
    setCurrentIssue: issue => {
      store.current = issue
      store.originalCurrent = cloneDeep(issue)
    },
    setCurrentIssueBody: body => {
      store.current.body = body
    },
    addLabel: label => {
      if (!store.current.labels) store.current.labels = []
      store.current.labels = store.current.labels.concat(label)
    },
    removeLabel: label => {
      if (!store.current.labels) store.current.labels = []
      store.current.labels = store.current.labels.filter(
        item => item.id !== label.id && item.id !== label.node_id
      )
    },
    updateIssue: async () => {
      const {number = undefined, title = '', body = '', labels = []} = store.current
      if (!title || !body) {
        return message.error('Please enter the content...')
      }

      if (!number) {
        const data = await RPC.emit('createIssue', [title, body, JSON.stringify(labels)])
        store.current.number = data.number
        store.current.html_url = data.html_url
        store.current.created_at = data.created_at
        store.current.updated_at = data.updated_at
        store.originalCurrent = cloneDeep(store.current)

        await store.archiveIssue(SUBMIT_TYPE.CREATE)
        return
      }

      const isDiff = compareIssue(store.current, store.originalCurrent)
      if (!isDiff) {
        return message.warning('No changes made.')
      }

      const data = await RPC.emit('updateIssue', [number, title, body, JSON.stringify(labels)])
      store.current.updated_at = data.updated_at
      store.originalCurrent = cloneDeep(store.current)

      await store.archiveIssue(SUBMIT_TYPE.UPDATE)
    },
    archiveIssue: async (type = SUBMIT_TYPE.UPDATE) => {
      try {
        const {number = undefined} = store.current
        const createdAt = store.current.created_at || store.current.createdAt

        if (!Number.isInteger(number)) return

        // 获取 Ref
        const commitSha = await RPC.emit('getRef')

        // 获取当前 Commit 的 Tree SHA
        const treeSha = await RPC.emit('getCommit', [commitSha])

        // 生成 Blob
        const markdown = generateMarkdown(store.current)
        const blobSha = await RPC.emit('createBlob', [markdown])

        // 生成 Tree
        const year = dayjs(createdAt).year()
        const filePath = `archives/${year}/${number}.md`
        const newTreeSha = await RPC.emit('createTree', [treeSha, filePath, blobSha])

        // 生成 Commit
        const commitMessage =
          type === SUBMIT_TYPE.CREATE
            ? `docs: create issue ${number}`
            : `docs: update issue ${number}`
        const newCommitSha = await RPC.emit('createCommit', [commitSha, newTreeSha, commitMessage])

        //  更新 Ref
        await RPC.emit('updateRef', [newCommitSha])
      } catch (e) {
        console.log('--> archiveIssue failed', e)
        message.error('Issue Archive Failed')
      }
    },
  }))

  useEffect(() => {
    RPC = new WebviewRPC(window, vscode)
    RPC.on('showSuccess', showSuccess)
    RPC.on('showError', showError)
    store.getLabels()
    store.getIssues()
  }, [])

  const checkFile = file => {
    const isLt2M = file.size / 1024 / 1024 < 2
    if (!isLt2M) {
      message.error('Image maxsize is 2MB')
    }
    return isLt2M
  }

  const uploadImages = e => {
    if (e.length === 0) return Promise.reject(new Error('Please select a image'))

    const img = e[0]
    if (!checkFile(img)) return Promise.reject(new Error('Image maxsize is 2MB'))

    const dayjsObj = dayjs()
    const ext = img.name.split('.').pop().toLowerCase()
    const path = `images/${dayjsObj.year()}/${dayjsObj.month() + 1}/${dayjsObj.valueOf()}.${ext}`

    const fileReader = new FileReader()
    fileReader.readAsDataURL(img)

    const hide = message.loading('Uploading Picture...', 0)
    return new Promise((resolve, reject) => {
      fileReader.onloadend = () => {
        const content = fileReader.result.split(',')[1]
        RPC.emit('uploadImage', [content, path])
          .then(res => {
            hide()
            message.success('Uploaded Successfully')
            resolve(res)
          })
          .catch(err => {
            reject(err)
            message.error('Upload Failed')
          })
      }
    })
  }

  return (
    <ConfigProvider theme={theme}>
      <div className="app">
        <Editor
          content={store.current.body || ''}
          labels={store.current.labels || []}
          number={store.current.number}
          placeholder="Leave your thought..."
          store={store}
          title={store.current.title || ''}
          totalLabels={store.labels || []}
          uploadImages={uploadImages}
        />
        <List
          currentPage={store.currentPage}
          issues={store.issues}
          labels={store.filterLabels}
          store={store}
          totalCount={store.totalCount}
          totalLabels={store.labels}
          visible={store.listVisible}
        />
        <LabelManager labels={store.labels} store={store} visible={store.labelsVisible} />
        <ActionBox number={store.current.number} store={store} />
      </div>
    </ConfigProvider>
  )
})

export default App
