import React from 'react';
import {StreamEvent} from '../../Event/StreamEvent';
import {IssueRepo} from '../../Repository/IssueRepo';
import {IssueEvent} from '../../Event/IssueEvent';
import {UserPrefRepo} from '../../Repository/UserPrefRepo';
import {StreamPolling} from '../../Repository/Polling/StreamPolling';
import {SubscriptionIssuesRepo} from '../../Repository/SubscriptionIssuesRepo';
import {StreamEntity} from '../../Library/Type/StreamEntity';
import {SortQueryEntity} from './IssuesHeaderFragment';
import {IssueEntity} from '../../Library/Type/IssueEntity';
import styled from 'styled-components';
import {IssueRow} from '../../Library/View/IssueRow';
import {IssueUpdatedBannerFragment} from './IssueUpdatedBannerFragment';
import {TimerUtil} from '../../Library/Util/TimerUtil';
import {ScrollView} from '../../Library/View/ScrollView';
import {Loading} from '../../Library/View/Loading';
import {appTheme} from '../../Library/Style/appTheme';
import {IssueIPC} from '../../../IPC/IssueIPC';
import {border} from '../../Library/Style/layout';
import {StreamId} from '../../Repository/StreamRepo';
import {View} from '../../Library/View/View';
import {IssuesHeaderFragment} from './IssuesHeaderFragment';

type Props = {
  className?: string;
}

type State = {
  stream: StreamEntity | null;
  filterQuery: string;
  sortQuery: SortQueryEntity;
  page: number;
  end: boolean;
  issues: IssueEntity[];
  totalCount: number,
  selectedIssue: IssueEntity;
  loading: boolean;
  updatedIssueIds: number[];
  fadeInIssueIds: number[];
  findingForSelectedIssue: boolean,
}

export class IssuesFragment extends React.Component<Props, State> {
  static defaultProps = {className: ''};

  state: State = {
    stream: null,
    filterQuery: '',
    sortQuery: 'sort:updated',
    page: -1,
    end: false,
    issues: [],
    totalCount: 0,
    selectedIssue: null,
    loading: false,
    findingForSelectedIssue: false,
    updatedIssueIds: [],
    fadeInIssueIds: [],
  };

  private scrollView: ScrollView;
  private lock: boolean = false;
  private issueRowRefs: {[issueId: number]: IssueRow} = {};

  componentDidMount() {
    StreamEvent.onSelectStream(this, (stream, issue) => {
      this.setState({stream, page: -1, end: false, filterQuery: stream.userFilter, selectedIssue: null, updatedIssueIds: []}, async () => {
        await this.loadIssues();
        if (issue) await this.handleSelectIssue(issue);
      });
    });

    // IssueEvent.onSelectIssue(this, (issue) => this.handleSelectIssue(issue));
    IssueEvent.onUpdateIssues(this, (issues) => this.handleUpdateIssues(issues));
    IssueEvent.onReadAllIssues(this, () => this.handleReloadIssuesWithUnselectIssue());

    IssueIPC.onReloadIssues(() => this.handleReloadIssuesWithUnselectIssue());
    IssueIPC.onSelectNextIssue(() => this.handleSelectNextPrevIssue(1));
    IssueIPC.onSelectNextUnreadIssue(() => this.handleSelectNextPrevIssue(1, true));
    IssueIPC.onSelectPrevIssue(() => this.handleSelectNextPrevIssue(-1));
    IssueIPC.onSelectPrevUnreadIssue(() => this.handleSelectNextPrevIssue(-1, true));
    IssueIPC.onToggleRead(() => this.handleToggleRead(this.state.selectedIssue));
    IssueIPC.onToggleArchive(() => this.handleToggleArchive(this.state.selectedIssue));
    IssueIPC.onToggleMark(() => this.handleToggleMark(this.state.selectedIssue));
    IssueIPC.onFilterToggleUnread(() => this.handleToggleFilter('is:unread'));
    IssueIPC.onFilterToggleOpen(() => this.handleToggleFilter('is:open'));
    IssueIPC.onFilterToggleMark(() => this.handleToggleFilter('is:bookmark'));
    IssueIPC.onFilterToggleAuthor(() => this.handleToggleFilter(`author:${UserPrefRepo.getUser().login}`));
    IssueIPC.onFilterToggleAssignee(() => this.handleToggleFilter(`assignee:${UserPrefRepo.getUser().login}`));
    IssueIPC.onClearFilter(() => this.handleExecFilterQuery(''));
  }

  componentWillUnmount() {
    StreamEvent.offAll(this);
    IssueEvent.offAll(this);
  }

  private async loadIssues() {
    if (this.lock) return;
    if (!this.state.stream) return;
    if (this.state.end) return;

    const stream = this.state.stream;
    const page = this.state.page + 1;

    const filters = [
      stream.defaultFilter,
      this.state.filterQuery,
      this.state.sortQuery,
    ];
    if (UserPrefRepo.getPref().general.onlyUnreadIssue) filters.push('is:unread');

    this.setState({loading: true});
    this.lock = true;
    const {error, issues, totalCount} = await IssueRepo.getIssuesInStream(stream.queryStreamId, filters.join(' '), '', page);
    this.lock = false;
    this.setState({loading: false});

    if (error) return console.error(error);

    const end = issues.length === 0;

    if (page === 0) {
      this.scrollView.scrollTop();
      this.setState({issues, page, end, totalCount});
    } else {
      // streamの更新タイミングによってはissueが重複してしまう。
      // なので現在のissueから重複するものを除外しておく
      const newIssueIds = issues.map(issue => issue.id);
      const currentIssues = this.state.issues.filter(issue => !newIssueIds.includes(issue.id));

      const allIssues = [...currentIssues, ...issues];
      this.setState({issues: allIssues, page, end, totalCount});
    }
  }

  // 外部から指定されたissueを選択状態にする場合、読み込み済みのissuesの中にない可能性がある。
  // なので追加のページを読み込み、issueを探すメソッドを用意した。
  private async findSelectedIssue(selectedIssueId: number): Promise<IssueEntity | null> {
    let selectedIssue: IssueEntity = null;
    do {
      selectedIssue = this.state.issues.find(issue => issue.id === selectedIssueId);
      if (selectedIssue) {
        this.setState({findingForSelectedIssue: false});
        return selectedIssue;
      }
      this.setState({findingForSelectedIssue: true});
      await this.loadIssues();
    } while(!this.state.end)

    return null;
  }

  private handleReloadIssuesWithUnselectIssue() {
    this.setState({page: -1, end: false, selectedIssue: null, updatedIssueIds: []}, () => {
      this.loadIssues();
    });
  }

  private async handleReloadWithUpdatedIssueIds() {
    const fadeInIssueIds = this.state.updatedIssueIds;
    this.setState({page: -1, end: false, updatedIssueIds: []}, async () => {
      await this.loadIssues();
      this.setState({fadeInIssueIds});
      await TimerUtil.sleep(1000);
      this.setState({fadeInIssueIds: []});
    });
  }

  private handleLoadMore() {
    this.loadIssues();
  }

  private handleUpdateIssues(updatedIssues: IssueEntity[]) {
    const issues = this.state.issues.map(issue => {
      const updatedIssue = updatedIssues.find(updatedIssue => updatedIssue.id === issue.id);
      return updatedIssue || issue;
    });
    this.setState({issues});
  }

  private async handleUpdateIssueIdsFromBanner(updatedIssueIds: number[]) {
    this.setState({updatedIssueIds});

    const {error, issues} = await IssueRepo.getIssues(updatedIssueIds);
    if (error) return console.error(error);
    this.handleUpdateIssues(issues);
  }

  private async handleSelectIssue(targetIssue: IssueEntity) {
    const selectedIssue = await this.findSelectedIssue(targetIssue.id);
    if (!selectedIssue) {
      return console.error(`not found targetIssue. targetIssue.id = ${targetIssue.id}, stream.id = ${this.state.stream.id}`);
    }

    this.setState({selectedIssue});

    const {error, issue: updatedIssue} = await IssueRepo.updateRead(targetIssue.id, new Date());
    if (error) return console.error(error);

    // issuesにある古いissueを差し替える
    const issues = this.state.issues.map(issue => issue.id === updatedIssue.id ? updatedIssue : issue);

    // issueを見たので、更新通知(updatedIssueIds)から除外する
    const updatedIssueIds = this.state.updatedIssueIds.filter(issueId => issueId !== updatedIssue.id);

    this.setState({issues, updatedIssueIds});

    IssueEvent.emitUpdateIssues([updatedIssue], [targetIssue], 'read');
    IssueEvent.emitSelectIssue(updatedIssue, targetIssue.read_body);
  }

  private async handleSelectNextPrevIssue(direction: 1 | -1, skipReadIssue?) {
    if (!this.state.issues.length) return;

    // まだissueが選択されていない場合、最初のissueを選択状態にする
    if (!this.state.selectedIssue) {
      await this.handleSelectIssue(this.state.issues[0]);
      return;
    }

    const currentIndex = this.state.issues.findIndex(issue => issue.id === this.state.selectedIssue.id);
    if (currentIndex < 0) return;

    let targetIndex;
    if (skipReadIssue) {
      for (let i = currentIndex + direction; this.state.issues[i]; i += direction) {
        const issue = this.state.issues[i];
        if (IssueRepo.isRead(issue)) continue;
        targetIndex = i;
        break;
      }
    } else {
      targetIndex = currentIndex + direction;
    }

    const issue =this.state.issues[targetIndex];
    if (issue) await this.handleSelectIssue(issue);
  }

  private handleExecFilterQuery(filterQuery: string) {
    this.setState({filterQuery, page: -1, end: false}, () => this.loadIssues());
  }

  private handleExecSortQuery(sortQuery: SortQueryEntity) {
    this.setState({sortQuery, page: -1, end: false}, () => this.loadIssues());
  }

  private handleToggleFilter(filter: string) {
    const regExp = new RegExp(` *${filter} *`);
    const matched = this.state.filterQuery.match(regExp);
    let filterQuery: string;
    if (matched) {
      filterQuery = this.state.filterQuery.replace(regExp, ' ').trim();
    } else {
      filterQuery = `${this.state.filterQuery} ${filter}`.trim();
    }

    this.setState({filterQuery, end: false, page: -1, selectedIssue: null, updatedIssueIds: []}, () => {
      this.loadIssues();
    });
  }

  private handleToggleFilterIssueType(issue: IssueEntity) {
    const filters: string[] = [
      `is:${issue.type}`,
      `is:${issue.closed_at ? 'closed' : 'open'}`,
    ];

    if (issue.type === 'pr') {
      filters.push(`is:${issue.draft ? 'draft' : 'undraft'}`);
      filters.push(`is:${issue.merged_at ? 'merged' : 'unmerged'}`);
    }
    this.handleToggleFilter(filters.join(' '));
  }

  private handleFilterProject(_issue: IssueEntity, projectName: string, projectColumn: string) {
    const filter1 = projectName.includes(' ') ? `project-name:"${projectName}"` : `project-name:${projectName}`;
    const filter2 = projectColumn.includes(' ') ? `project-column:"${projectColumn}"` : `project-column:${projectColumn}`;
    this.handleToggleFilter(`${filter1} ${filter2}`);
  }

  private handleFilterMilestone(issue: IssueEntity) {
    const milestone = issue.value.milestone.title;
    let filter: string;
    if (milestone.includes(' ')) {
      filter = `milestone:"${milestone}"`;
    } else {
      filter = `milestone:${milestone}`;
    }
    this.handleToggleFilter(filter);
  }

  private handleFilterLabel(_issue: IssueEntity, label: string) {
    let filter: string;
    if (label.includes(' ')) {
      filter = `label:"${label}"`;
    } else {
      filter = `label:${label}`;
    }
    this.handleToggleFilter(filter);
  }

  private handleFilterAuthor(issue: IssueEntity) {
    this.handleToggleFilter(`author:${issue.author}`);
  }

  private handleFilterAssignee(_issue: IssueEntity, assignee: string) {
    this.handleToggleFilter(`assignee:${assignee}`);
  }

  private handleFilterRepoOrg(issue: IssueEntity) {
    this.handleToggleFilter(`org:${issue.user}`);
  }

  private handleFilterRepoName(issue: IssueEntity) {
    this.handleToggleFilter(`repo:${issue.repo}`);
  }

  private handleFilterIssueNumber(issue: IssueEntity) {
    this.handleToggleFilter(`number:${issue.number}`);
  }

  private async handleToggleMark(targetIssue: IssueEntity | null) {
    if (!targetIssue) return;

    const date = targetIssue.marked_at ? null : new Date();
    const {error, issue: updatedIssue} = await IssueRepo.updateMark(targetIssue.id, date);
    if (error) return console.error(error);

    this.handleUpdateIssues([updatedIssue]);

    if (this.state.selectedIssue?.id === updatedIssue.id) this.setState({selectedIssue: updatedIssue});

    IssueEvent.emitUpdateIssues([updatedIssue], [targetIssue], 'mark');
  }

  private async handleToggleRead(targetIssue: IssueEntity | null) {
    if (!targetIssue) return;

    const date = IssueRepo.isRead(targetIssue) ? null : new Date();
    const {error, issue: updatedIssue} = await IssueRepo.updateRead(targetIssue.id, date);
    if (error) return console.error(error);

    this.handleUpdateIssues([updatedIssue]);

    if (this.state.selectedIssue?.id === updatedIssue.id) this.setState({selectedIssue: updatedIssue});

    IssueEvent.emitUpdateIssues([updatedIssue], [targetIssue], 'read');
  }

  private async handleToggleArchive(targetIssue: IssueEntity | null) {
    if (!targetIssue) return;

    const date = targetIssue.archived_at ? null : new Date();
    const {error, issue: updatedIssue} = await IssueRepo.updateArchive(targetIssue.id, date);
    if (error) return console.error(error);

    const issues = this.state.issues.filter(issue => issue.id !== updatedIssue.id);
    this.setState({issues});

    if (this.state.selectedIssue?.id === updatedIssue.id) this.setState({selectedIssue: updatedIssue});

    IssueEvent.emitUpdateIssues([updatedIssue], [targetIssue], 'archive');
  }

  private async handleUnsubscribe(targetIssue: IssueEntity) {
    const url = targetIssue.value.html_url;
    const {error} = await SubscriptionIssuesRepo.unsubscribe(url);
    if (error) return console.error(error);

    const issues = this.state.issues.filter(issue => issue.id !== targetIssue.id);
    this.setState({issues});

    await StreamPolling.refreshStream(StreamId.subscription);
    StreamEvent.emitReloadAllStreams();
  }

  private async handleCreateFilterStream() {
    StreamEvent.emitCreateFilterStream(this.state.stream.queryStreamId, this.state.filterQuery);
  }

  private async handleReadAll() {
    if (confirm(`Would you like to mark "${this.state.stream.name}" all as read?`)) {

      const stream = this.state.stream;
      const {error} = await IssueRepo.updateReadAll(stream.queryStreamId, stream.defaultFilter, stream.userFilter);
      if (error) return console.error(error);

      this.setState({page: -1}, async () => {
        await this.loadIssues();
        IssueEvent.emitReadAllIssues(stream.id);
      });
    }
  }

  private async handleReadCurrent() {
    if (confirm('Would you like to mark current issues as read?')) {
      const oldIssues = [...this.state.issues];
      const issueIds = this.state.issues.map(issue => issue.id);
      const {error, issues} = await IssueRepo.updateReads(issueIds, new Date());
      if (error) return console.error(error);

      const newIssues = oldIssues.map(oldIssue => {
        const newIssue = issues.find(issue => issue.id === oldIssue.id);
        return newIssue || oldIssue;
      });
      this.setState({issues: newIssues});
      IssueEvent.emitUpdateIssues(issues, oldIssues, 'read');
    }
  }

  render() {
    const loadingClassName = this.state.loading && this.state.page === -1 ? 'issues-first-page-loading' : '';
    const findingClassName = this.state.findingForSelectedIssue ? 'issues-finding-selected-issue' : '';

    return (
      <Root className={`${loadingClassName} ${findingClassName} ${this.props.className}`}>
        <IssuesHeaderFragment
          streamName={this.state.stream?.name}
          issueCount={this.state.totalCount}
          filterQuery={this.state.filterQuery}
          sortQuery={this.state.sortQuery}
          onExecFilter={filterQuery => this.handleExecFilterQuery(filterQuery)}
          onExecToggleFilter={filterQuery => this.handleToggleFilter(filterQuery)}
          onExecSort={sortQuery => this.handleExecSortQuery(sortQuery)}
        />

        <IssuesScrollView
          onEnd={() => this.handleLoadMore()}
          horizontalResizable={true}
          ref={ref => this.scrollView = ref}
        >
          {this.renderUpdatedBanner()}
          {this.renderIssues()}
          {this.renderLoading()}
        </IssuesScrollView>
      </Root>
    );
  }

  private renderUpdatedBanner() {
    return (
      <IssueUpdatedBannerFragment
        stream={this.state.stream}
        filter={this.state.filterQuery}
        updatedIssueIds={this.state.updatedIssueIds}
        onChange={updatedIssueIds => this.handleUpdateIssueIdsFromBanner(updatedIssueIds)}
        onClick={() => this.handleReloadWithUpdatedIssueIds()}
      />
    );
  }

  private renderIssues() {
    return this.state.issues.map(issue => {
      const fadeIn = this.state.fadeInIssueIds.includes(issue.id);
      const selected = issue.id === this.state.selectedIssue?.id;

      let onUnsubscribe = null;
      if (this.state.stream.id === StreamId.subscription) {
        onUnsubscribe = (issue: IssueEntity) => this.handleUnsubscribe(issue);
      }

      let onCreateFilterStream = null;
      if (this.state.stream.type === 'UserStream' || this.state.stream.type === 'FilterStream') {
        onCreateFilterStream = () => this.handleCreateFilterStream();
      }

      return (
        <IssueRow
          key={issue.id}
          issue={issue}
          selected={selected}
          fadeIn={fadeIn}
          skipHandlerSameCheck={true}
          scrollIntoViewIfNeededWithCenter={true}
          onSelect={issue => this.handleSelectIssue(issue)}
          onToggleIssueType={issue => this.handleToggleFilterIssueType(issue)}
          onToggleProject={(issue, projectName, projectColumn) => this.handleFilterProject(issue, projectName, projectColumn)}
          onToggleMilestone={issue => this.handleFilterMilestone(issue)}
          onToggleLabel={(issue, label) => this.handleFilterLabel(issue, label)}
          onToggleAuthor={issue => this.handleFilterAuthor(issue)}
          onToggleAssignee={(issue, assignee) => this.handleFilterAssignee(issue, assignee)}
          onToggleRepoOrg={issue => this.handleFilterRepoOrg(issue)}
          onToggleRepoName={issue => this.handleFilterRepoName(issue)}
          onToggleIssueNumber={issue => this.handleFilterIssueNumber(issue)}
          onToggleMark={issue => this.handleToggleMark(issue)}
          onToggleArchive={issue => this.handleToggleArchive(issue)}
          onToggleRead={issue => this.handleToggleRead(issue)}
          onReadAll={() => this.handleReadAll()}
          onReadCurrentAll={() => this.handleReadCurrent()}
          onUnsubscribe={onUnsubscribe}
          onCreateFilterStream={onCreateFilterStream}
          ref={ref => this.issueRowRefs[issue.id] = ref}
        />
      );
    });
  }

  private renderLoading() {
    const show = this.state.loading && this.state.page > -1;
    return <Loading show={show}/>;
  }
}

const Root = styled(View)`
  height: 100%;
  background: ${() => appTheme().bg};
  border-right: solid ${border.medium}px ${() => appTheme().borderColor};
`;

const IssuesScrollView = styled(ScrollView)`
  width: 320px;
  flex: 1;
  
  .issues-first-page-loading & {
    opacity: 0.3;
  }

  .issues-finding-selected-issue & {
    opacity: 0.3;
  }
`;
